#!/usr/bin/env python3
"""Opt-in real isolated PG18/Timescale/pgvector roundtrip. Never uses live containers.

Run: uv run --with psycopg2-binary python packages/integration-tests/scripts/test-postgres-backup-real.py
All synthetic data, TLS keys, containers and tmpfs databases are removed in finally.
"""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).parents[3]
spec = importlib.util.spec_from_file_location('backup', ROOT / 'stackarr/scripts/postgres-backup.py')
assert spec and spec.loader
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
IMAGE = os.environ.get('STACKARR_TEST_POSTGRES_IMAGE', 'timescale/timescaledb-ha:pg18.1-ts2.25.0')


def run(args, data=None, env=None, timeout=120):
    proc = subprocess.run(args, input=data, capture_output=True, env=env, timeout=timeout)
    if proc.returncode:
        raise RuntimeError(f'fixture command failed ({args[0]}): {proc.stderr.decode()[:1800]}')
    return proc.stdout


def sql(container, query, db='postgres', user='postgres'):
    return run(['docker', 'exec', '-i', container, 'psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db], query.encode())


def main():
    prefix = 'stackarr-pg-test-' + secrets.token_hex(4)
    containers = []
    source_password = ''
    target_password = ''
    report = dict(tests=[])
    with tempfile.TemporaryDirectory(prefix=prefix+'-') as temporary:
        temp = Path(temporary)
        try:
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(temp/'server.key'),
                 '-out', str(temp/'server.crt'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
            for role in ('source', 'target', 'restore'):
                name = prefix + '-' + role
                env = {**os.environ, 'POSTGRES_PASSWORD': secrets.token_urlsafe(24)}
                user = 'restore_admin' if role == 'restore' else 'postgres'
                args = ['docker', 'create', '--name', name, '--label', 'stackarr.test=postgres-backup', '--memory', '768m', '--cpus', '1',
                        '--tmpfs', '/var/lib/postgresql/data:rw,uid=1000,gid=1000,mode=0700', '-e', 'PGDATA=/var/lib/postgresql/data',
                        '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER='+user, '-e', 'POSTGRES_DB=postgres']
                if role in ('source', 'target'):
                    args += ['-p', '127.0.0.1::5432']
                if role in ('source', 'target'):
                    args += ['--user', '0', '--entrypoint', '/bin/sh', IMAGE, '-c',
                             'chown 1000:1000 /home/postgres/server.key /home/postgres/server.crt; chmod 600 /home/postgres/server.key; exec /docker-entrypoint.sh "$@"',
                             'stackarr-fixture', 'postgres']
                else:
                    args += [IMAGE, 'postgres']
                args += ['-c', 'shared_buffers=32MB', '-c', 'max_connections=20']
                if role in ('source', 'target'):
                    args += ['-c', 'ssl=on', '-c', 'ssl_cert_file=/home/postgres/server.crt', '-c', 'ssl_key_file=/home/postgres/server.key']
                run(args, env=env)
                containers.append(name)
                if role in ('source', 'target'):
                    run(['docker', 'cp', str(temp/'server.crt'), name+':/home/postgres/server.crt'])
                    run(['docker', 'cp', str(temp/'server.key'), name+':/home/postgres/server.key'])
                    run(['docker', 'start', name])

                    if role == 'target':
                        target_password = env['POSTGRES_PASSWORD']
                    else:
                        source_password = env['POSTGRES_PASSWORD']
                else:
                    run(['docker', 'start', name])
                ready = False
                for _ in range(80):
                    proc = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', user], capture_output=True)
                    if proc.returncode == 0:
                        try:
                            sql(name, 'SELECT 1;', user=user)
                            ready = True
                            break
                        except RuntimeError:
                            pass
                    time.sleep(.5)
                if not ready:
                    raise RuntimeError('Fixture database did not become ready: '+role)
            source, target_name, restore = containers
            sql(target_name, 'CREATE DATABASE backup_store TEMPLATE template0;')
            # Hosted providers can leave public-scoped default ACL metadata in an otherwise empty database.
            sql(target_name, '''CREATE ROLE backup_bystander;
              ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC;
              ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO PUBLIC;''', 'backup_store')
            dependencies = sql(target_name, "SELECT classid::regclass,deptype FROM pg_depend WHERE refclassid='pg_namespace'::regclass AND refobjid='public'::regnamespace ORDER BY 1,2", 'backup_store')
            assert dependencies == b'pg_default_acl|a\npg_default_acl|a\n', dependencies
            sql(source, "CREATE ROLE archive_owner; CREATE ROLE app_reader; CREATE DATABASE app_data OWNER archive_owner; CREATE TABLE administrative_note(id int PRIMARY KEY, note text); INSERT INTO administrative_note VALUES(1,'admin database included');")
            sql(source, """CREATE EXTENSION IF NOT EXISTS timescaledb;
              CREATE EXTENSION IF NOT EXISTS vector;
              CREATE SCHEMA events AUTHORIZATION archive_owner;
              CREATE TYPE events.mood AS ENUM ('calm','busy');
              CREATE TABLE events.metrics(time timestamptz NOT NULL, device int NOT NULL, value double precision, PRIMARY KEY(time,device));
              SELECT create_hypertable('events.metrics','time');
              INSERT INTO events.metrics SELECT '2025-01-01'::timestamptz + x * interval '1 hour', x%3, x/10.0 FROM generate_series(1,100) x;
              ALTER TABLE events.metrics SET (timescaledb.compress, timescaledb.compress_segmentby='device');
              SELECT compress_chunk(x) FROM show_chunks('events.metrics') x;
              CREATE TABLE events.embedding(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, value vector(3), mood events.mood DEFAULT 'calm');
              INSERT INTO events.embedding(value) VALUES('[1,2,3]'),('[4,5,6]');
              CREATE INDEX ON events.embedding USING hnsw(value vector_l2_ops);
              ALTER TABLE events.embedding OWNER TO archive_owner;
              GRANT SELECT ON events.embedding TO app_reader;
              GRANT USAGE ON SCHEMA events TO app_reader;
              CREATE FUNCTION events.answer() RETURNS int LANGUAGE SQL IMMUTABLE AS 'SELECT 42';
              SELECT lo_from_bytea(12345, decode('00ff00aabb','hex'));
              """, 'app_data')
            sql(source, 'CREATE DATABASE template_custom; ALTER DATABASE template_custom IS_TEMPLATE true;')
            sql(source, 'CREATE TABLE template_payload(id int); INSERT INTO template_payload VALUES(9);', 'template_custom')
            info = backup.Source({'STACKARR_PG_BACKUP_SOURCE_CONTAINER': source}).inventory()
            capture = temp/'capture'
            capture.mkdir()
            artifacts = backup.Source({'STACKARR_PG_BACKUP_SOURCE_CONTAINER': source}).capture(capture, info)
            manifest = dict(format=1, generation=str(uuid.uuid4()), source=info, artifacts=artifacts)
            assert [a['database'] for a in artifacts] == [None, 'app_data', 'postgres', 'template1', 'template_custom']
            class ChangingGlobals(backup.Source):
                def execute(self, tool, args, **kwargs):
                    result = super().execute(tool, args, **kwargs)
                    if tool == 'pg_dumpall':
                        sql(source, 'CREATE ROLE concurrent_owner; ALTER TABLE events.embedding OWNER TO concurrent_owner;', 'app_data')
                    return result
            changed = temp / 'changed-globals'
            changed.mkdir()
            try:
                ChangingGlobals({'STACKARR_PG_BACKUP_SOURCE_CONTAINER': source}).capture(changed, info)
                raise AssertionError('concurrently changed globals accepted')
            except backup.BackupError as error:
                assert 'global settings changed' in str(error)
            sql(source, 'ALTER TABLE events.embedding OWNER TO archive_owner; DROP ROLE concurrent_owner;', 'app_data')
            report['tests'].append('custom templates captured; concurrent role changes fail before publication')
            port = run(['docker', 'port', target_name, '5432/tcp']).decode().strip().rsplit(':',1)[1]
            os.environ['SSL_CERT_FILE'] = str(temp/'server.crt')
            url = f'postgresql://postgres:{target_password}@localhost:{port}/backup_store?sslmode=verify-full'
            exported = temp/'exported'
            controller_image = os.environ.get('STACKARR_TEST_CONTROLLER_IMAGE')
            if controller_image:
                controller = prefix + '-controller'
                (temp/'backups').mkdir()
                env = {**os.environ, 'STACKARR_PG_BACKUP_URL': f'postgresql://postgres:{target_password}@localhost:5432/backup_store?sslmode=verify-full'}
                run(['docker', 'create', '--name', controller, '--label', 'stackarr.test=postgres-backup', '--memory', '384m', '--cpus', '1',
                     '--group-add', os.environ.get('STACKARR_TEST_DOCKER_GID', '0'),
                     '--network', 'container:'+target_name, '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
                     '--mount', 'type=bind,source='+str(temp)+',target=/fixture', '-e', 'STACKARR_PG_BACKUP_URL',
                     '-e', 'SSL_CERT_FILE=/fixture/server.crt', '-e', 'STATE_ROOT=/fixture/state', '-e', 'BACKUP_ROOT=/fixture/backups',
                     '-e', 'STACKARR_PG_BACKUP_SOURCE_CONTAINER='+source, '--entrypoint', '/bin/sh', controller_image, '-c',
                     'python3 /app/stackarr/scripts/postgres-backup.py run && python3 /app/stackarr/scripts/postgres-backup.py export --output /fixture/backups/exported && python3 /app/stackarr/scripts/postgres-backup.py status'], env=env)
                containers.append(controller)
                run(['docker', 'start', '-a', controller], timeout=240)
                assert run(['docker', 'inspect', '--format', '{{.State.ExitCode}}', controller]).strip() == b'0'
                exported = temp/'backups/exported'
                manifest = json.loads((exported/'manifest.json').read_text())
                artifacts, info, capture = manifest['artifacts'], manifest['source'], exported
                status = json.loads((temp/'state/postgres-backup/status.json').read_text())
                assert status['state'] == 'succeeded' and status['generation'] == manifest['generation']
                assert len(status['coverage']) == 4
                report['tests'].append('built controller CLI: native capture, TLS publication, verified export and cached status')
            else:
                with backup.target(url) as connection:
                    backup.publish(connection, capture, manifest)
                exported.mkdir()
                with backup.target(url) as connection:
                    connection.set_session(isolation_level='REPEATABLE READ', readonly=True)
                    assert backup.export_backup(connection, exported) == manifest
            report['tests'].append('native dump and binary COPY publication with TLS verify-full')
            assert sql(target_name, "SELECT has_schema_privilege('backup_bystander','stackarr_backup_v1','USAGE'),has_table_privilege('backup_bystander','stackarr_backup_v1.chunks','SELECT')", 'backup_store').strip() == b'f|f'
            report['tests'].append('public-scoped permissive default ACLs do not expose the backup schema or chunks')
            for a in artifacts:
                assert hashlib.sha256((exported/a['file']).read_bytes()).hexdigest() == a['sha256']
            report['tests'].append('complete exported byte checksums')
            # A mid-publication digest failure must leave the previous pointer and data unchanged.
            broken = json.loads(json.dumps(manifest))
            broken['generation'] = str(uuid.uuid4())
            broken['artifacts'][1]['sha256'] = '0'*64
            try:
                with backup.target(url) as connection:
                    backup.publish(connection, capture, broken)
                raise AssertionError('corrupt generation promoted')
            except backup.BackupError:
                pass
            with backup.target(url) as connection:
                with connection.cursor() as cur:
                    cur.execute('SELECT current_generation::text FROM stackarr_backup_v1.identity')
                    assert cur.fetchone()[0] == manifest['generation']
                    cur.execute('SELECT count(*) FROM stackarr_backup_v1.generations')
                    assert cur.fetchone()[0] == 1
            report['tests'].append('partial failure rolls back and preserves last good generation')
            with backup.target(url) as holder, backup.target(url) as contender:
                with holder.cursor() as cur:
                    cur.execute('SELECT pg_try_advisory_xact_lock(748154, 1)')
                    assert cur.fetchone()[0]
                try:
                    backup.publish(contender, capture, dict(manifest, generation=str(uuid.uuid4())))
                    raise AssertionError('overlapping publication accepted')
                except backup.BackupError as error:
                    assert 'lock' in str(error)
                contender.rollback()
                holder.rollback()
            report['tests'].append('overlapping publication rejected by advisory lock')
            sql(target_name, 'CREATE TABLE public.unrelated(id int); INSERT INTO public.unrelated VALUES(7);', 'backup_store')
            with backup.target(url) as connection:
                try:
                    backup.publish(connection, capture, dict(manifest, generation=str(uuid.uuid4())))
                    raise AssertionError('unrelated object accepted')
                except backup.BackupError:
                    connection.rollback()
            assert sql(target_name, 'SELECT id FROM public.unrelated', 'backup_store').strip() == b'7'
            sql(target_name, 'DROP TABLE public.unrelated;', 'backup_store')
            for create, drop in [('CREATE FUNCTION public.unrelated() RETURNS int LANGUAGE SQL AS $$SELECT 1$$;',
                                  'DROP FUNCTION public.unrelated();'),
                                 ('CREATE TYPE public.unrelated AS ENUM (\'x\');',
                                  'DROP TYPE public.unrelated;')]:
                sql(target_name, create, 'backup_store')
                with backup.target(url) as connection:
                    try:
                        backup.publish(connection, capture, dict(manifest, generation=str(uuid.uuid4())))
                        raise AssertionError('unrelated public object accepted')
                    except backup.BackupError as error:
                        assert 'unrelated public objects' in str(error)
                        connection.rollback()
                sql(target_name, drop, 'backup_store')
            sql(target_name, "UPDATE stackarr_backup_v1.identity SET owner='different-cluster';", 'backup_store')
            with backup.target(url) as connection:
                try:
                    backup.publish(connection, capture, dict(manifest, generation=str(uuid.uuid4())))
                    raise AssertionError('ownership mismatch accepted')
                except backup.BackupError:
                    connection.rollback()
            sql(target_name, "UPDATE stackarr_backup_v1.identity SET owner='" + info['systemIdentifier'] + "';", 'backup_store')
            report['tests'].append('unrelated objects preserved and wrong estate ownership rejected')
            source_port = run(['docker', 'port', source, '5432/tcp']).decode().strip().rsplit(':', 1)[1]
            sql(source, 'CREATE DATABASE other_backup TEMPLATE template0;')
            source_url = f'postgresql://postgres:{source_password}@localhost:{source_port}/other_backup?sslmode=verify-full'
            # Model an inventory taken before a source restart: uptime differs,
            # immutable systemIdentifier still identifies the same cluster.
            stale_manifest = json.loads(json.dumps(manifest))
            stale_manifest['source']['startedAt'] = '2000-01-01T00:00:00+00:00'
            with backup.target(source_url) as connection:
                try:
                    backup.publish(connection, capture, dict(stale_manifest, generation=str(uuid.uuid4())))
                    raise AssertionError('same-cluster target accepted')
                except backup.BackupError as error:
                    assert 'overlaps' in str(error) or 'source PostgreSQL cluster' in str(error)
                    connection.rollback()
            assert sql(source, "SELECT count(*) FROM pg_namespace WHERE nspname='stackarr_backup_v1'").strip() == b'0'
            report['tests'].append('same-cluster source destination rejected without writes')
            generations = [manifest['generation']]
            for _ in range(3):
                updated = dict(manifest, generation=str(uuid.uuid4()))
                with backup.target(url) as connection:
                    backup.publish(connection, capture, updated)
                generations.append(updated['generation'])
                with backup.target(url) as connection:
                    with connection.cursor() as cur:
                        cur.execute('SELECT current_generation::text FROM stackarr_backup_v1.identity')
                        assert cur.fetchone()[0] == generations[-1]
                        cur.execute('SELECT id::text FROM stackarr_backup_v1.generations ORDER BY id')
                        assert sorted(row[0] for row in cur.fetchall()) == sorted(generations[-2:])
            report['tests'].append('retries rotate current and previous generations only')
            previous_export = temp/'previous-export'
            previous_export.mkdir()
            with backup.target(url) as connection:
                connection.set_session(isolation_level='REPEATABLE READ', readonly=True)
                assert backup.export_backup(connection, previous_export, previous=True)['generation'] == generations[-2]
            report['tests'].append('previous recovery point exports independently')
            with backup.target(url) as connection:
                with connection.cursor() as cur:
                    cur.execute('UPDATE stackarr_backup_v1.chunks SET data=%s WHERE generation=%s AND artifact=0 AND ordinal=0',
                                (b'tampered', generations[-1]))
                corrupt = temp/'corrupt-export'
                corrupt.mkdir()
                try:
                    backup.export_backup(connection, corrupt)
                    raise AssertionError('remote corruption exported')
                except backup.BackupError as error:
                    assert 'checksum' in str(error)
                connection.rollback()
            with backup.target(url) as connection:
                with connection.cursor() as cur:
                    cur.execute('SELECT current_generation::text FROM stackarr_backup_v1.identity')
                    assert cur.fetchone()[0] == generations[-1]
            report['tests'].append('remote checksum failure cannot promote or export corrupt bytes')
            marker = '/tmp/stackarr-cancel-' + secrets.token_hex(8)
            try:
                backup.Source({'STACKARR_PG_BACKUP_SOURCE_CONTAINER': source}).execute(
                    'sh', ['-c', 'sleep 5; touch '+marker], timeout=1)
                raise AssertionError('remote command did not time out')
            except subprocess.TimeoutExpired:
                pass
            time.sleep(6)
            assert subprocess.run(['docker', 'exec', source, 'test', '-e', marker], capture_output=True).returncode != 0
            assert sql(source, 'SELECT 1').strip() == b'1'
            report['tests'].append('timed-out remote command cancelled, source remains available')
            # Restore database-level ownership/ACL/properties as well as objects.
            # Only this disposable isolated cluster's bootstrap DBs are removed.
            sql(restore, 'CREATE DATABASE recovery_control TEMPLATE template0;', user='restore_admin')
            sql(restore, (exported/'globals.sql').read_text(), 'recovery_control', 'restore_admin')
            sql(restore, 'ALTER DATABASE template1 IS_TEMPLATE false; DROP DATABASE template1; DROP DATABASE postgres;', 'recovery_control', 'restore_admin')
            for artifact in artifacts[1:]:
                db = artifact['database']
                dump = (exported/artifact['file']).read_bytes()
                toc = run(['docker', 'exec', '-i', restore, 'pg_restore', '--list', '--create'], dump).decode()
                db_entry = re.compile(r' (?:DATABASE(?: PROPERTIES)? -|(?:ACL|COMMENT|SECURITY LABEL) - DATABASE) ')
                database_toc = '\n'.join(line for line in toc.splitlines() if db_entry.search(line)) + '\n'
                objects_toc = '\n'.join(line for line in toc.splitlines() if not db_entry.search(line)) + '\n'
                assert ' DATABASE - ' in database_toc, '\n'.join(line for line in toc.splitlines() if 'DATABASE' in line)
                run(['docker', 'exec', '-i', restore, 'sh', '-c', 'cat > /tmp/database.list'], database_toc.encode())
                run(['docker', 'exec', '-i', restore, 'sh', '-c', 'cat > /tmp/objects.list'], objects_toc.encode())
                run(['docker', 'exec', '-i', restore, 'pg_restore', '-U', 'restore_admin', '-d', 'recovery_control', '--exit-on-error', '--create', '--use-list=/tmp/database.list'], dump)
                sql(restore, 'CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();', db, 'restore_admin')
                run(['docker', 'exec', '-i', restore, 'pg_restore', '-U', 'restore_admin', '-d', db, '--exit-on-error', '--use-list=/tmp/objects.list'], dump)
                sql(restore, 'SELECT timescaledb_post_restore();', db, 'restore_admin')
            db_properties = "SELECT datname,pg_get_userbyid(datdba),ARRAY(SELECT a::text FROM unnest(datacl) a ORDER BY a::text),datcollate,datctype,datistemplate FROM pg_database WHERE datname IN ('app_data','postgres','template1','template_custom') ORDER BY datname"
            original_properties = sql(source, db_properties)
            recovered_properties = sql(restore, db_properties, 'recovery_control', 'restore_admin')
            assert original_properties == recovered_properties, (original_properties, recovered_properties)
            checks = [
                ('postgres', 'SELECT * FROM administrative_note ORDER BY id'),
                ('template_custom', 'SELECT * FROM template_payload'),
                ('app_data', 'SELECT count(*),sum(value) FROM events.metrics'),
                ('app_data', 'SELECT id,value,mood FROM events.embedding ORDER BY id'),
                ('app_data', "SELECT extname,extversion FROM pg_extension ORDER BY extname"),
                ('app_data', "SELECT schemaname,tablename,indexdef FROM pg_indexes WHERE schemaname='events' ORDER BY indexname"),
                ('app_data', "SELECT encode(lo_get(12345),'hex')"),
                ('app_data', 'SELECT events.answer()'),
                ('app_data', "SELECT count(*) FROM timescaledb_information.chunks WHERE is_compressed")]
            for db, query in checks:
                original, recovered = sql(source, query, db), sql(restore, query, db, 'restore_admin')
                assert original == recovered, f'{query}: source={original!r}, restored={recovered!r}'
            assert sql(restore, 'SELECT last_value FROM events.embedding_id_seq', 'app_data', 'restore_admin').strip() == b'2'
            ownership = "SELECT n.nspname,pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname='events'"
            grants = "SELECT has_schema_privilege('app_reader','events','USAGE'),has_table_privilege('app_reader','events.embedding','SELECT')"
            assert sql(source, ownership, 'app_data') == sql(restore, ownership, 'app_data', 'restore_admin')
            assert sql(source, grants, 'app_data') == sql(restore, grants, 'app_data', 'restore_admin') == b't|t\n'
            role_properties = "SELECT rolname,rolsuper,rolinherit,rolcanlogin,rolpassword FROM pg_authid WHERE rolname IN ('postgres','archive_owner','app_reader') ORDER BY rolname"
            assert sql(source, role_properties) == sql(restore, role_properties, user='restore_admin'), 'role properties differ'
            assert sql(restore, "INSERT INTO events.embedding(value) VALUES('[7,8,9]') RETURNING id", 'app_data', 'restore_admin').strip() == b'3'
            report['tests'].append('matching-engine restore: admin DB, compressed hypertables, vector index, schemas, enum, sequence, function, large object')
            # Native source data remains untouched throughout.
            assert sql(source, 'SELECT count(*) FROM events.metrics', 'app_data').strip() == b'100'
            report['tests'].append('source preservation')
            report['archiveBytes'] = sum(a['bytes'] for a in artifacts)
            report['databaseCount'] = len(info['databases'])
            report['engine'] = info['version']
            print(json.dumps(report, indent=2))
        finally:
            keep = os.environ.get('STACKARR_TEST_KEEP_CONTAINERS') == 'true'
            for name in reversed(containers):
                command = ['docker', 'stop', '-t', '10', name] if keep else ['docker', 'rm', '-f', name]
                subprocess.run(command, capture_output=True, timeout=40)
            if keep:
                print(json.dumps({'retainedStoppedFixtures': containers}))
            elif run(['docker', 'ps', '-aq', '--filter', 'name='+prefix]).strip():
                raise RuntimeError('Fixture containers remain after cleanup')

if __name__ == '__main__':
    main()
