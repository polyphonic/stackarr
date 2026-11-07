#!/usr/bin/env python3
"""Explicit database capture plan -> independently verifiable, transport-neutral bundle.

No discovery, upload, decrypt or live restore. Output must be on a caller-verified
external filesystem; the CLI deliberately does not select a destination.

Plan JSON: {"inventoryNote":"explicit scope", "exclusions":["media, images"],
"sources":[{"id":"app-main","engine":"sqlite","owner":"app",
"locator":"/absolute/path/to/app.db","checker":null,"passwordEnv":null,
"user":null,"generation":null,"dockerContainer":null}]}. For Plex SQLite, checker MUST be the
owner's compatible native SQLite executable. PostgreSQL locator is an existing
format-1 generation directory; generation must match its manifest UUID.
SQL/Redis locators are host:port; SQL user is explicit and passwordEnv names an
environment variable (never a password). dockerContainer selects a trusted,
running source engine container for native clients; for MariaDB this uses its
local socket (the locator port is then informational). PostgreSQL may select a
trusted client container for pg_restore --list. Credentials never enter manifests.
MariaDB archives include user databases and portable user/grant definitions;
MySQL uses native database tables. Triggers, routines and events are included,
but a per-database single transaction cannot cover concurrent DDL or grants.
Coordinate those writes separately. No restore test
or independent point-in-time cross-engine transaction is claimed. Plaintext
archives contain private data: encrypt with the established backup-crypto.cjs
pipeline before external transport; this module intentionally has no key access.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
import zipfile

FORMAT = 'stackarr-database-bundle-v1'
ENGINES = {'sqlite', 'mysql', 'mariadb', 'redis', 'postgres'}
MAX_BYTES = 1024 ** 5

class BundleError(Exception):
    pass

def require(ok, message='Invalid database bundle or capture plan'):
    if not ok:
        raise BundleError(message)

def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def valid_time(value):
    require(isinstance(value, str))
    try:
        parsed = dt.datetime.fromisoformat(value)
        require(parsed.tzinfo is not None)
        return parsed
    except ValueError:
        raise BundleError('Invalid timestamp') from None

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_fingerprint(stream, limit=MAX_BYTES):
    sha = hashlib.sha256()
    count = 0
    while chunk := stream.read(1024 * 1024):
        count += len(chunk)
        require(count <= limit, 'Artifact exceeds size bound')
        sha.update(chunk)
    return count, sha.hexdigest()

def regular(path):
    require(not path.is_symlink() and path.is_file(), 'Artifact must be a regular non-symlink file')
    return path

def safe_directory(path):
    require(path.is_dir() and not path.is_symlink(), 'Unsafe directory')
    for ancestor in (path, *path.parents):
        require(not ancestor.is_symlink(), 'Symlink directory ancestor')
    return path

def checked_plan(plan):
    require(type(plan) is dict and set(plan) == {'sources', 'exclusions', 'inventoryNote'})
    require(isinstance(plan['inventoryNote'], str) and 0 < len(plan['inventoryNote']) <= 2000)
    require(type(plan['exclusions']) is list and all(isinstance(x, str) and x for x in plan['exclusions']))
    sources = plan['sources']
    require(type(sources) is list and 0 < len(sources) <= 256)
    ids = set()
    for s in sources:
        require(type(s) is dict and set(s) == {'id', 'engine', 'owner', 'locator', 'checker', 'passwordEnv', 'user', 'generation', 'dockerContainer'})
        require(type(s['id']) is str and re.fullmatch(r'[a-z][a-z0-9-]{0,63}', s['id']) and s['id'] not in ids)
        ids.add(s['id'])
        require(type(s['engine']) is str and s['engine'] in ENGINES and isinstance(s['owner'], str) and s['owner'])
        require(isinstance(s['locator'], str) and s['locator'])
        require(s['checker'] is None or isinstance(s['checker'], str) and s['checker'].startswith('/'))
        require(s['passwordEnv'] is None or type(s['passwordEnv']) is str and re.fullmatch(r'[A-Z][A-Z0-9_]*', s['passwordEnv']))
        require(s['dockerContainer'] is None or type(s['dockerContainer']) is str and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', s['dockerContainer']))
        require(s['dockerContainer'] is None or s['engine'] in ('mysql', 'mariadb', 'redis', 'postgres'))
        if s['engine'] in ('sqlite', 'postgres'):
            require(s['passwordEnv'] is None)
        if s['engine'] == 'sqlite' and 'plex' in (s['owner'] + s['locator']).lower():
            require(s['checker'] is not None, 'Plex SQLite requires its native checker')
        if s['engine'] == 'postgres':
            require(s['checker'] is None)
            require(canonical_uuid(s['generation']))
        else:
            require(s['generation'] is None)
        if s['engine'] in ('mysql', 'mariadb'):
            require(type(s['user']) is str and re.fullmatch(r'[A-Za-z0-9_@.-]{1,128}', s['user']))
        else:
            require(s['user'] is None)
        if s['engine'] != 'sqlite':
            require(s['checker'] is None)
        if s['engine'] in ('mysql', 'mariadb', 'redis'):
            require(re.fullmatch(r'[A-Za-z0-9_.-]+:[0-9]{1,5}', s['locator']))
            require(0 < int(s['locator'].rsplit(':', 1)[1]) <= 65535)
    return sources

def run(command, *, output=None, timeout=600, env=None, input_file=None):
    try:
        result = subprocess.run(command, stdin=input_file, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, env=env, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BundleError('Native database command unavailable or timed out') from None
    require(result.returncode == 0, 'Native database command failed (diagnostics withheld)')
    return result.stdout

def canonical_uuid(value):
    if type(value) is not str:
        return False
    try:
        return str(uuid.UUID(value)) == value
    except ValueError:
        return False

def docker_identity(container):
    data = json.loads(run(['docker', 'inspect', '--type=container', container], timeout=10))
    require(type(data) is list and len(data) == 1 and data[0]['State']['Running'], 'Source container not running')
    require(data[0]['Id'].startswith(container) or data[0]['Name'] == '/' + container, 'Source container mismatch')
    return data[0]['Id'], data[0]['Image']

def sqlite_capture(source, target, checker, timeout):
    require(regular(source).stat().st_size > 0)
    started = time.monotonic()
    binary = checker or sys.executable
    if checker:
        require(regular(Path(checker)) and os.access(checker, os.X_OK), 'Native SQLite checker missing')
    from urllib.parse import quote
    reader = sqlite3.connect(f'file:{quote(str(source))}?mode=ro', uri=True, timeout=5)
    writer = None
    try:
        reader.execute('BEGIN')
        reader.execute('SELECT count(*) FROM sqlite_master').fetchone()
        writer = sqlite3.connect(str(target))
        reader.backup(writer, pages=128, sleep=.05, progress=lambda *args: require(time.monotonic()-started < timeout, 'SQLite snapshot timed out'))
        writer.close(); writer = None
    finally:
        if writer is not None:
            writer.close()
        reader.rollback(); reader.close()
    require(time.monotonic()-started < timeout, 'SQLite snapshot timed out')
    # The backup can inherit WAL mode. Checkpoint its private snapshot and close
    # before compressing the main file; never delete a live source journal.
    checkpoint = sqlite3.connect(str(target), timeout=5)
    try:
        require(checkpoint.execute('PRAGMA journal_mode=DELETE').fetchone()[0] == 'delete', 'Snapshot checkpoint failed')
    finally:
        checkpoint.close()
    if checker:
        result = run([binary, str(target), 'PRAGMA integrity_check;'], timeout=max(1, int(timeout-(time.monotonic()-started))))
        require(result.strip() == b'ok', 'Native SQLite integrity check failed')
        version = run([binary, '-version'], timeout=10).decode(errors='replace').splitlines()[0][:100]
    else:
        connection = sqlite3.connect(f'file:{quote(str(target))}?mode=ro', uri=True)
        try:
            connection.set_progress_handler(lambda: 1 if time.monotonic()-started >= timeout else 0, 1000)
            require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'SQLite integrity check failed')
        finally:
            connection.close()
        version = sqlite3.sqlite_version
    return version

def validate_postgres_manifest(manifest):
    module_path = Path(__file__).with_name('postgres-backup.py')
    require(regular(module_path))
    spec = importlib.util.spec_from_file_location('stackarr_postgres_backup', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.validate_manifest(manifest)
    except (module.BackupError, KeyError, TypeError, ValueError, AttributeError):
        raise BundleError('Invalid PostgreSQL recovery manifest') from None
    return manifest

def postgres_capture(source, target, generation, client_container=None):
    safe_directory(source)
    manifest_path = regular(source / 'manifest.json')
    require(manifest_path.stat().st_size < 1024 * 1024)
    manifest = validate_postgres_manifest(json.loads(manifest_path.read_text()))
    require(manifest['generation'] == generation, 'PostgreSQL generation mismatch')
    require(manifest['format'] == 1 and manifest['artifacts'] and manifest['source']['systemIdentifier'])
    require(set(p.name for p in source.iterdir()) == {'manifest.json', *(a['file'] for a in manifest['artifacts'])}, 'Unexpected PostgreSQL archive members')
    require(len(manifest['artifacts']) == len(manifest['source']['databases'])+1)
    require(manifest['artifacts'][0]['file'] == 'globals.sql')
    identity = docker_identity(client_container) if client_container else None
    for i, a in enumerate(manifest['artifacts']):
        p = regular(source / a['file'])
        with p.open('rb') as f:
            size, sha = file_fingerprint(f)
        require(size == a['bytes'] and sha == a['sha256'], 'PostgreSQL archive checksum mismatch')
        if i:
            require(p.open('rb').read(5) == b'PGDMP', 'Invalid PostgreSQL archive')
            if identity:
                with p.open('rb') as archive:
                    run(['docker', 'exec', '-i', identity[0], 'pg_restore', '--list'], input_file=archive, timeout=120)
            else:
                run(['pg_restore', '--list', str(p)], timeout=120)
        else:
            require(p.stat().st_size > 0)
    # A single opaque inner generation, preserving native format-1 metadata and files.
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        for name in sorted(p.name for p in source.iterdir()):
            z.write(source / name, name)
    return str(manifest['source']['version']), manifest, identity

def capture_native(s, target, timeout):
    engine = s['engine']
    host, port = s['locator'].rsplit(':', 1)
    secret = s['passwordEnv']
    require(secret is None or bool(os.environ.get(secret)), 'Credential environment variable missing')
    container = s['dockerContainer']
    identity = docker_identity(container) if container else None
    # Docker exec's explicit env is passed to the container process only. Never
    # serialize credentials into a plan, command argv, exception or manifest.
    prefix = ['docker', 'exec'] if container else []
    if container:
        prefix += ['-e', 'MYSQL_PWD' if engine in ('mysql', 'mariadb') else 'REDISCLI_AUTH'] if secret else []
        # Docker -e NAME copies the host environment without exposing its value in argv.
        prefix += [identity[0]]
        host = '127.0.0.1'  # only the explicitly named source container
    if engine in ('mysql', 'mariadb'):
        dump = ('mariadb-dump' if engine == 'mariadb' else 'mysqldump')
        client = ('mariadb' if engine == 'mariadb' else 'mysql')
        if not container:
            dump, client = shutil.which(dump), shutil.which(client)
        require(dump is not None and client is not None, 'Native SQL dump/client binary missing')
        # MYSQL_PWD is inherited by the child only; never argv, logs, or manifest.
        env = dict(os.environ)
        env.pop('MYSQL_PWD', None)
        if secret:
            env['MYSQL_PWD'] = env[secret]
        connection_args = ['--protocol=socket'] if container else ['--host', host, '--port', port]
        version = run(prefix + [client, '--batch', '--skip-column-names', *connection_args,
                       '--user', s['user'], '-e', 'SELECT VERSION()'], timeout=10, env=env).decode(errors='replace').strip()[:150]
        require(bool(version), 'SQL server version unavailable')
        databases = run(prefix + [client, '--batch', '--skip-column-names', *connection_args,
                        '--user', s['user'], '-e', 'SHOW DATABASES'], timeout=10, env=env).decode().splitlines()
        require(databases and all(re.fullmatch(r'[A-Za-z0-9_]{1,64}', d) for d in databases), 'SQL inventory invalid')
        databases = [d for d in databases if d not in ('information_schema', 'performance_schema', 'sys')]
        if engine == 'mariadb':
            databases = [d for d in databases if d != 'mysql']
        require(databases, 'No database inventoried')
        command = [dump, *connection_args, '--user', s['user'], '--databases', *databases, '--single-transaction',
                   '--routines', '--events', '--triggers', '--hex-blob']
        with target.open('xb') as out:
            run(prefix + command, output=out, timeout=timeout, env=env)
            if engine == 'mariadb':
                out.write(b'\n-- Native portable user and grant definitions\n')
                # Replace bootstrap accounts exactly. Restore with a temporary
                # administrator absent from the source, not an account being replaced.
                run(prefix + [dump, *connection_args, '--user', s['user'], '--system=users', '--replace'],
                    output=out, timeout=timeout, env=env)
        require(target.stat().st_size > 100 and b'CREATE DATABASE' in target.open('rb').read(65536), 'SQL dump incomplete')
        return version, identity
    cli = 'redis-cli' if container else shutil.which('redis-cli')
    checker = 'redis-check-rdb' if container else shutil.which('redis-check-rdb')
    require(cli and checker, 'Redis capture/check binaries missing')
    env = dict(os.environ)
    env.pop('REDISCLI_AUTH', None)
    if secret:
        env['REDISCLI_AUTH'] = env[secret]
    version = run(prefix + [cli, '-h', host, '-p', port, '--raw', 'INFO', 'server'], timeout=10, env=env)
    match = re.search(rb'^redis_version:([^\r\n]+)', version, re.M)
    require(match is not None, 'Redis server version unavailable')
    with target.open('xb') as out:
        run(prefix + [cli, '-h', host, '-p', port, '--rdb', '-'], output=out, timeout=timeout, env=env)
    require(target.open('rb').read(5) == b'REDIS', 'Redis RDB stream unavailable')
    if container:
        # checker accepts a pathname, not stdin; mount only the caller's private
        # external artifact read-only into an isolated matching-image checker.
        # No copy or second bulk staging on the container's internal disk.
        require(target.stat().st_size <= 512 * 1024 * 1024, 'Redis checker size bound exceeded')
        image = identity[1]
        try:
            result = subprocess.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
                '--memory', '640m', '--cpus', '1', '--mount', f'type=bind,src={target.resolve()},dst=/check/dump.rdb,readonly',
                '--entrypoint', 'redis-check-rdb', image, '/check/dump.rdb'],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise BundleError('Redis checker unavailable or timed out') from None
        require(result.returncode == 0, 'Redis RDB integrity check failed')
    else:
        run([checker, str(target)], timeout=timeout)
    return match.group(1).decode()[:100], identity

def capture(plan, destination, timeout=600):
    sources = checked_plan(plan)
    destination = Path(destination)
    require(not destination.exists(), 'Destination already exists')
    safe_directory(destination.parent)
    require(destination.parent.stat().st_mode & 0o077 == 0, 'Destination parent must be private')
    destination.mkdir(mode=0o700)
    records = []
    previous_umask = os.umask(0o077)
    try:
        for index, s in enumerate(sources):
            engine = s['engine']
            filename = f'component-{index:04d}.' + ('pg.zip' if engine == 'postgres' else 'sqlite.gz' if engine == 'sqlite' else 'sql.gz' if engine in ('mysql','mariadb') else 'rdb.gz')
            raw = destination / f'.component-{index:04d}.partial'
            start = stamp()
            provenance = None
            identity = None
            try:
                if engine == 'sqlite':
                    version = sqlite_capture(Path(s['locator']), raw, s['checker'], timeout)
                elif engine == 'postgres':
                    version, provenance, identity = postgres_capture(Path(s['locator']), raw, s['generation'], s['dockerContainer'])
                else:
                    version, identity = capture_native(s, raw, timeout)
                require(raw.stat().st_size > 0, 'Empty native artifact')
                artifact = destination / filename
                if engine == 'postgres':
                    raw.rename(artifact)
                else:
                    with raw.open('rb') as inp, artifact.open('xb') as out:
                        with gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as gz:
                            shutil.copyfileobj(inp, gz)
                    raw.unlink()
                with artifact.open('rb') as f:
                    size, sha = file_fingerprint(f)
                record = dict(id=s['id'], engine=engine, owner=s['owner'], locator=s['locator'],
                              file=filename, bytes=size, sha256=sha, engineVersion=version,
                              startedAt=start, finishedAt=stamp(), dockerImageId=identity[1] if identity else None,
                              sourceGeneration=provenance['generation'] if provenance else None,
                              sourceCreatedAt=provenance['createdAt'] if provenance else None,
                              sourceCaptureStartedAt=min(a['startedAt'] for a in provenance['artifacts']) if provenance else None,
                              sourceCaptureFinishedAt=max(a['finishedAt'] for a in provenance['artifacts']) if provenance else None)
                records.append(record)
            finally:
                raw.unlink(missing_ok=True)
        manifest = dict(format=FORMAT, generation=str(uuid.uuid4()), createdAt=stamp(),
                        inventoryNote=plan['inventoryNote'], exclusions=plan['exclusions'], components=records)
        validate(manifest)
        manifest_path = destination / 'manifest.json'
        with manifest_path.open('x') as out:
            out.write(json.dumps(manifest, indent=2)+'\n')
        manifest_path.chmod(0o600)
        verify(destination)
        return manifest
    except BaseException:
        # Only the newly created directory is ours; never touch pre-existing output.
        shutil.rmtree(destination)
        raise
    finally:
        os.umask(previous_umask)

def validate(m):
    require(type(m) is dict and set(m) == {'format','generation','createdAt','inventoryNote','exclusions','components'})
    require(m['format'] == FORMAT and canonical_uuid(m['generation']))
    valid_time(m['createdAt'])
    require(type(m['inventoryNote']) is str and m['inventoryNote'])
    require(type(m['exclusions']) is list and all(type(x) is str for x in m['exclusions']))
    components = m['components']
    require(type(components) is list and 0 < len(components) <= 256)
    ids = set()
    for i, c in enumerate(components):
        require(type(c) is dict and set(c) == {'id','engine','owner','locator','file','bytes','sha256','engineVersion','startedAt','finishedAt','dockerImageId','sourceGeneration','sourceCreatedAt','sourceCaptureStartedAt','sourceCaptureFinishedAt'})
        require(type(c['id']) is str and re.fullmatch(r'[a-z][a-z0-9-]{0,63}', c['id']) and c['id'] not in ids)
        ids.add(c['id'])
        require(type(c['engine']) is str and c['engine'] in ENGINES and type(c['owner']) is str and c['owner'])
        require(type(c['locator']) is str and c['locator'])
        require(c['dockerImageId'] is None or type(c['dockerImageId']) is str and re.fullmatch(r'sha256:[a-f0-9]{64}', c['dockerImageId']))
        if c['engine'] not in ('mysql', 'mariadb', 'redis', 'postgres'):
            require(c['dockerImageId'] is None)
        if c['engine'] == 'postgres':
            require(canonical_uuid(c['sourceGeneration']))
            require(valid_time(c['sourceCaptureStartedAt']) <= valid_time(c['sourceCaptureFinishedAt']))
            require(valid_time(c['sourceCaptureFinishedAt']) <= valid_time(c['startedAt']))
            valid_time(c['sourceCreatedAt'])
        else:
            require(all(c[k] is None for k in ('sourceGeneration','sourceCreatedAt','sourceCaptureStartedAt','sourceCaptureFinishedAt')))
        require(type(c['engineVersion']) is str and c['engineVersion'])
        ext = 'pg.zip' if c['engine'] == 'postgres' else 'sqlite.gz' if c['engine'] == 'sqlite' else 'sql.gz' if c['engine'] in ('mysql','mariadb') else 'rdb.gz'
        require(c['file'] == f'component-{i:04d}.{ext}')
        require(type(c['bytes']) is int and 0 < c['bytes'] < MAX_BYTES)
        require(type(c['sha256']) is str and re.fullmatch('[a-f0-9]{64}', c['sha256']))
        require(valid_time(c['startedAt']) <= valid_time(c['finishedAt']))
    return components

def verify(path):
    path = safe_directory(Path(path))
    mpath = regular(path / 'manifest.json')
    require(mpath.stat().st_size < 1024 * 1024)
    m = json.loads(mpath.read_text())
    components = validate(m)
    require(set(p.name for p in path.iterdir()) == {'manifest.json', *(c['file'] for c in components)}, 'Unexpected bundle members')
    for c in components:
        file = regular(path / c['file'])
        with file.open('rb') as f:
            size, sha = file_fingerprint(f)
        require(size == c['bytes'] and sha == c['sha256'], 'Bundle checksum mismatch')
        if c['engine'] == 'postgres':
            with zipfile.ZipFile(file) as z:
                require('manifest.json' in z.namelist() and len(z.namelist()) == len(set(z.namelist())))
                require(all(i.compress_type == zipfile.ZIP_STORED and '/' not in i.filename and '\\' not in i.filename and '..' not in i.filename for i in z.infolist()))
                require(z.getinfo('manifest.json').file_size < 1024 * 1024)
                inner = validate_postgres_manifest(json.loads(z.read('manifest.json')))
                require(inner['format'] == 1)
                require(inner['generation'] == c['sourceGeneration'] and inner['createdAt'] == c['sourceCreatedAt'])
                require(min(a['startedAt'] for a in inner['artifacts']) == c['sourceCaptureStartedAt'])
                require(max(a['finishedAt'] for a in inner['artifacts']) == c['sourceCaptureFinishedAt'])
                require(set(z.namelist()) == {'manifest.json', *(a['file'] for a in inner['artifacts'])})
                for a in inner['artifacts']:
                    require(z.getinfo(a['file']).file_size == a['bytes'])
                    with z.open(a['file']) as f:
                        size, sha = file_fingerprint(f)
                    require(size == a['bytes'] and sha == a['sha256'])
        else:
            with gzip.open(file, 'rb') as f:
                require(file_fingerprint(f)[0] > 0, 'Empty compressed component')
    return m

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    c = sub.add_parser('capture'); c.add_argument('plan'); c.add_argument('destination'); c.add_argument('--timeout', type=int, default=600)
    v = sub.add_parser('verify'); v.add_argument('destination')
    args = parser.parse_args()
    try:
        if args.action == 'capture':
            require(0 < args.timeout <= 3600)
            manifest = capture(json.loads(regular(Path(args.plan)).read_text()), args.destination, args.timeout)
        else:
            manifest = verify(args.destination)
        print(json.dumps({'generation': manifest['generation'], 'components': len(manifest['components']), 'verified': True}))
    except (BundleError, OSError, ValueError, KeyError, zipfile.BadZipFile, sqlite3.Error) as exc:
        print(f'Database bundle failed: {type(exc).__name__}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
