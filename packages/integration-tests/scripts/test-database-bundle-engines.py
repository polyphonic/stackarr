#!/usr/bin/env python3
"""Opt-in, isolated real-engine capture and restore on a verified external staging directory."""
import gzip
import hashlib
import importlib.util

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile

MODULE = Path(__file__).resolve().parents[3] / 'stackarr/scripts/database-bundle.py'
spec = importlib.util.spec_from_file_location('bundle_fixture_module', MODULE)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
RUN_ID = uuid.uuid4().hex
LABEL = 'stackarr.database-bundle-fixture=' + RUN_ID
NAMES = tuple('stackarr-bundle-' + kind + '-' + RUN_ID for kind in
              ('mariadb-fixture', 'mariadb-restore', 'redis-fixture', 'redis-restore', 'pg-fixture', 'pg-restore'))

def command(args, *, stdin=None, env=None, timeout=90):
    r = subprocess.run(args, input=stdin, capture_output=True, env=env, timeout=timeout)
    if r.returncode:
        raise RuntimeError('Fixture command failed: ' + ' '.join(args[:3]) + ' code=' + str(r.returncode) + ' stderr=' + r.stderr.decode(errors='replace')[:400] + ' stdout=' + r.stdout.decode(errors='replace')[:200])
    return r.stdout

def docker(*args, **kw):
    return command(['docker', *args], **kw)

def cleanup():
    for name in NAMES:
        if docker('ps', '-aq', '--filter', 'name=^/'+name+'$').strip():
            label = docker('inspect', '--format', '{{index .Config.Labels "stackarr.database-bundle-fixture"}}', name).strip()
            if label != RUN_ID.encode():
                raise RuntimeError('Refusing cleanup of a foreign container')
            docker('rm', '-f', '-v', name)

def start(name, image, *args, memory='256m', mounts=()):
    opts = ['run', '-d', '--name', name, '--label', LABEL, '--network', 'none', '--memory', memory,
            '--cpus', '1', *mounts]
    if image.startswith('mariadb'):
        opts += ['-e', 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=yes']
    if image.startswith('timescale'):
        opts += ['-e', 'POSTGRES_HOST_AUTH_METHOD=trust']
    docker(*(opts + [image, *args]))
    for _ in range(45):
        if docker('inspect', '--format', '{{.State.Running}}', name).strip() == b'true':
            try:
                if image.startswith('mariadb'):
                    if b'MariaDB init process done' not in (lambda p: p.stdout+p.stderr)(subprocess.run(['docker','logs',name],capture_output=True)):
                        raise RuntimeError('MariaDB initialization still in progress')
                    docker('exec', name, 'mariadb-admin', 'ping', '--silent', timeout=3)
                elif image.startswith('redis'):
                    docker('exec', name, 'redis-cli', 'PING', timeout=3)
                else:
                    docker('exec', '-u', 'postgres', name, 'pg_isready', '-q', timeout=3)
                return
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
        time.sleep(1)
    raise RuntimeError('Fixture did not become ready: ' + name + ' logs=' + subprocess.run(['docker','logs','--tail','15',name],capture_output=True).stderr.decode(errors='replace')[-1200:])

def source(engine, name, port, user=None):
    return dict(id='fixture', engine=engine, owner='fixture-service', locator='127.0.0.1:'+str(port),
                checker=None, passwordEnv=None, user=user, generation=None, dockerContainer=name)

def plan(s):
    return dict(sources=[s], inventoryNote='Isolated fixture only', exclusions=['non-database files'])

def capture(s, root, key):
    dest = root/key
    m = b.capture(plan(s), dest, timeout=50)
    assert b.verify(dest) == m
    assert m['components'][0]['dockerImageId'].startswith('sha256:')
    return dest

def sql(name, statement):
    return docker('exec', name, 'mariadb', '-u', 'root', '--batch', '--skip-column-names', '-e', statement)

def pg(name, sqltext, db='postgres'):
    return docker('exec', '-u', 'postgres', name, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sqltext)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def mariadb(root):
    name, restored = NAMES[:2]
    image = 'mariadb:10.11'
    # No host ports, isolated tmpfs data; no credentials in CLI or manifest.
    mounts = ('--tmpfs', '/var/lib/mysql:rw,size=512m')
    start(name, image, memory='768m', mounts=mounts)
    sql(name, "CREATE DATABASE fixture; CREATE TABLE fixture.items(id INT PRIMARY KEY, text VARCHAR(32)); INSERT INTO fixture.items VALUES (1,'alpha'),(2,'beta'); CREATE VIEW fixture.v AS SELECT id FROM fixture.items; CREATE USER 'fixture_reader'@'localhost'; GRANT SELECT ON fixture.* TO 'fixture_reader'@'localhost';")
    expected = sql(name, 'SELECT id,text FROM fixture.items ORDER BY id; SHOW GRANTS FOR fixture_reader@localhost;')
    ident = b.docker_identity(name)[0]
    probe = subprocess.run(['docker','exec',ident,'mariadb','--batch','--skip-column-names','--protocol=socket','--user','root','-e','SELECT VERSION()'],capture_output=True)
    assert probe.returncode == 0, 'Native client preflight: ' + probe.stderr.decode(errors='replace')[:300]
    dest = capture(source('mariadb', name, 3306, 'root'), root, 'mariadb-bundle')
    # Restore is intentionally performed in a separate, never-existing instance.
    start(restored, image, memory='768m', mounts=mounts)
    sql(restored, "CREATE USER 'fixture_restore_admin'@'localhost'; GRANT ALL PRIVILEGES ON *.* TO 'fixture_restore_admin'@'localhost' WITH GRANT OPTION; GRANT PROXY ON ''@'%' TO 'fixture_restore_admin'@'localhost' WITH GRANT OPTION;")
    with gzip.open(dest/'component-0000.sql.gz', 'rb') as inp:
        dump = inp.read()
    try:
        docker('exec', '-i', restored, 'mariadb', '-u', 'fixture_restore_admin', stdin=dump)
    except RuntimeError:
        print('MariaDB restore state:', docker('inspect','--format','{{.State.OOMKilled}} {{.State.ExitCode}}',restored).decode().strip(), flush=True)
        print('MariaDB restore logs:', docker('logs','--tail','15',restored).decode(errors='replace')[-1500:],flush=True)
        print('MariaDB restore storage:', docker('exec',restored,'df','-h','/var/lib/mysql').decode().strip() if docker('inspect','--format','{{.State.Running}}',restored).strip()==b'true' else 'stopped',flush=True)
        raise
    actual = sql(restored, 'SELECT id,text FROM fixture.items ORDER BY id; SHOW GRANTS FOR fixture_reader@localhost;')
    assert actual == expected, 'MariaDB data/grants mismatch'
    assert sql(restored, 'SHOW CREATE VIEW fixture.v') == sql(name, 'SHOW CREATE VIEW fixture.v')
    print('MariaDB restored rows=2 grants=1 view=1 hash=' + sha(actual)[:12], flush=True)
    return dest

def redis(root):
    name, restored = NAMES[2:4]
    image = 'redis:8.8.0-alpine'
    start(name, image, 'redis-server', '--save', '', '--appendonly', 'no', '--protected-mode', 'no', memory='192m', mounts=('--tmpfs','/data:rw,size=32m'))
    docker('exec', name, 'redis-cli', 'SET', 'fixture:string', 'value')
    docker('exec', name, 'redis-cli', 'HSET', 'fixture:hash', 'field', 'other')
    docker('exec', name, 'redis-cli', 'SADD', 'fixture:set', 'a', 'b')
    docker('exec', name, 'redis-cli', 'SET', 'fixture:ttl', 'expires')
    docker('exec', name, 'redis-cli', 'EXPIRE', 'fixture:ttl', '3600')
    dest = capture(source('redis', name, 6379), root, 'redis-bundle')
    with gzip.open(dest/'component-0000.rdb.gz', 'rb') as inp:
        data = inp.read()
    assert data[:5] == b'REDIS'
    path = root/'redis-restored'
    path.mkdir(mode=0o700)
    (path/'dump.rdb').write_bytes(data)
    start(restored, image, 'redis-server', '--dir', '/data', '--protected-mode', 'no', '--appendonly', 'no', memory='192m', mounts=('-v',str(path)+':/data'))
    for key, typ in [('fixture:string',b'string'),('fixture:hash',b'hash'),('fixture:set',b'set'),('fixture:ttl',b'string')]:
        assert docker('exec',restored,'redis-cli','--raw','TYPE',key).strip() == typ
    assert docker('exec',restored,'redis-cli','--raw','GET','fixture:string').strip() == b'value'
    assert docker('exec',restored,'redis-cli','--raw','HGET','fixture:hash','field').strip() == b'other'
    assert docker('exec',restored,'redis-cli','SCARD','fixture:set').strip() == b'2'
    assert int(docker('exec',restored,'redis-cli','TTL','fixture:ttl').strip()) > 0
    print('Redis restored keys=4 types=3 ttl=positive hash=' + sha(data)[:12], flush=True)
    return dest

def postgres(root):
    name, restored = NAMES[4:6]
    image = 'timescale/timescaledb-ha:pg18.1-ts2.25.0'
    # Run native image as postgres with private tmpfs. Upstream entrypoint accepts POSTGRES_HOST_AUTH_METHOD.
    mounts = ('--tmpfs','/home/postgres/pgdata:rw,size=192m,uid=1000,gid=1000')
    start(name, image, memory='512m', mounts=mounts)
    pg(name, "CREATE ROLE fixture_reader LOGIN;")
    pg(name, "CREATE DATABASE fixture OWNER postgres;")
    pg(name, "CREATE SCHEMA fixture; CREATE TABLE fixture.items(id int primary key, value text); INSERT INTO fixture.items VALUES (1,'alpha'),(2,'beta'); GRANT USAGE ON SCHEMA fixture TO fixture_reader; GRANT SELECT ON fixture.items TO fixture_reader;", 'fixture')
    expected = pg(name, 'SELECT id,value FROM fixture.items ORDER BY id', 'fixture')
    roles = pg(name, "SELECT rolname FROM pg_roles WHERE rolname='fixture_reader'")
    assert roles.strip() == b'fixture_reader'
    src = root/'pg-generation'; src.mkdir(mode=0o700)
    started = b.stamp()
    globals_data = docker('exec','-u','postgres',name,'pg_dumpall','--globals-only', timeout=50)
    (src/'globals.sql').write_bytes(globals_data)
    dump_data = docker('exec','-u','postgres',name,'pg_dump','-Fc','--create','-d','fixture', timeout=50)
    (src/'database-0000.dump').write_bytes(dump_data)
    finished = b.stamp()
    artifacts = [dict(file=file, database=db, bytes=(src/file).stat().st_size, sha256=sha((src/file).read_bytes()), startedAt=started, finishedAt=finished)
                 for file, db in [('globals.sql',None),('database-0000.dump','fixture')]]
    generation = str(uuid.uuid4())
    manifest = dict(format=1,generation=generation,createdAt=finished,stackarrVersion='fixture',
                    source=dict(systemIdentifier='fixture-isolated',version='18',databases=[dict(name='fixture')]),
                    artifacts=artifacts,mode='native-archive',consistency='per-database snapshot; not a cross-database transaction')
    (src/'manifest.json').write_text(json.dumps(manifest))
    s = source('postgres',str(src),0); s['locator']=str(src); s['generation']=generation; s['dockerContainer']=name
    dest = root/'pg-bundle'
    result = b.capture(plan(s), dest, timeout=50)
    assert result['components'][0]['sourceGeneration'] == generation
    assert result['components'][0]['sourceCaptureFinishedAt'] == finished
    assert b.verify(dest) == result
    with zipfile.ZipFile(dest/result['components'][0]['file']) as archive:
        assert json.loads(archive.read('manifest.json'))['generation'] == generation
        recovered_globals = archive.read('globals.sql')
        recovered_dump = archive.read('database-0000.dump')
    start(restored,image,memory='512m',mounts=(*mounts,'-e','POSTGRES_USER=fixture_restore_admin'))
    docker('exec','-i','-u','postgres',restored,'psql','-X','-U','fixture_restore_admin','-d','postgres',
           '-v','ON_ERROR_STOP=1',stdin=recovered_globals,timeout=50)
    docker('exec','-i','-u','postgres',restored,'pg_restore','--exit-on-error','--create','-d','postgres',stdin=recovered_dump,timeout=50)
    actual = pg(restored,'SELECT id,value FROM fixture.items ORDER BY id','fixture')
    assert actual == expected
    assert pg(restored,"SELECT rolname FROM pg_roles WHERE rolname='fixture_reader'").strip() == roles.strip()
    assert pg(restored,"SELECT has_table_privilege('fixture_reader','fixture.items','SELECT')",'fixture').strip() == b't'
    print('PostgreSQL restored rows=2 role=1 privilege=1 hash=' + sha(actual)[:12], flush=True)
    return dest

def main():
    base = Path(os.environ['BUNDLE_FIXTURE_ROOT']).resolve(strict=True)
    staging = Path(os.environ['BUNDLE_FIXTURE_STAGING_ROOT']).resolve(strict=True)
    assert base.is_dir() and not base.is_symlink() and base.stat().st_mode & 0o077 == 0
    assert staging.is_dir() and base != staging and base.is_relative_to(staging)
    assert base.stat().st_dev == staging.stat().st_dev != Path.home().stat().st_dev
    before = set(docker('ps','-aq').decode().split())
    before_times = {item: docker('inspect','--format','{{.State.StartedAt}}',item) for item in before}
    try:
        root = Path(tempfile.mkdtemp(prefix='database-bundle-real-',dir=base))
        os.chmod(root,0o700)
        for label, fn in [('MariaDB',mariadb),('Redis',redis),('PostgreSQL',postgres)]:
            print('Running '+label,flush=True)
            dest = fn(root)
            artifact = next(dest.glob('component-*'))
            damaged = root/(label.lower()+'-damaged')
            shutil.copytree(dest,damaged)
            with (damaged/artifact.name).open('ab') as out: out.write(b'corrupt')
            try: b.verify(damaged)
            except b.BundleError: pass
            else: raise AssertionError('Corruption accepted: '+label)
            print(label+' corruption rejected',flush=True)
            cleanup()
        print('All real-engine captures and restores passed',flush=True)
    finally:
        cleanup()
        after = set(docker('ps','-aq').decode().split())
        assert after == before, 'Unrelated container identity changed or fixture leaked'
        assert {item: docker('inspect','--format','{{.State.StartedAt}}',item) for item in before} == before_times, 'Unrelated container restarted'

if __name__=='__main__': main()
