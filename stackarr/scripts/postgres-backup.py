#!/usr/bin/env python3
"""Lossless native PostgreSQL archives in an isolated PostgreSQL repository.

No target connection is retained outside a bounded job. Native archives are not
converted to target schemas: restore requires the recorded source engine and
extension versions. All SQL identifiers in the repository are fixed literals.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import ssl
import struct
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qsl, unquote, urlsplit
import uuid
from zoneinfo import ZoneInfo

FORMAT = 1
CHUNK = 1024 * 1024
MAX_DATABASES = 256
JOB_SECONDS = 7200
SCHEMA = 'stackarr_backup_v1'


class BackupError(Exception):
    """Only static, secret-free messages cross the CLI/status boundary."""


def target_parameters(raw):
    try:
        if not raw or re.search(r'[\x00-\x20\x7f#]', raw) or re.search(r'%(?![0-9a-fA-F]{2})', raw):
            raise ValueError()
        url = urlsplit(raw)
        if url.scheme not in ('postgres', 'postgresql') or not url.hostname or not url.username or not url.password:
            raise ValueError()
        if re.search(r'-pooler(?:\.|$)', url.hostname, re.I) or ',' in url.hostname or '%' in url.hostname:
            raise ValueError()
        db = unquote(url.path[1:], errors='strict') if url.path.startswith('/') else ''
        user, password = unquote(url.username, errors='strict'), unquote(url.password, errors='strict')
        if not db or '/' in db or any(re.search(r'[\x00-\x1f\x7f]', s) for s in (db, user, password)):
            raise ValueError()
        pairs = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True)
        if len(dict(pairs)) != len(pairs):
            raise ValueError()
        for key, val in pairs:
            if key == 'sslmode' and val in ('require', 'verify-full'):
                continue
            if key == 'channel_binding' and val in ('require', 'prefer'):
                continue
            raise ValueError()
        params = dict(host=url.hostname, port=url.port or 5432, dbname=db, user=user, password=password,
                      sslmode='verify-full', sslrootcert=ssl.get_default_verify_paths().cafile or '/etc/ssl/cert.pem',
                      channel_binding=dict(pairs).get('channel_binding', 'prefer'), connect_timeout=10,
                      application_name='stackarr-postgres-backup',
                      options='-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=120000 -c search_path=pg_catalog',
                      keepalives=1, keepalives_idle=15, keepalives_interval=5, keepalives_count=3, tcp_user_timeout=30000)
        return params
    except (ValueError, UnicodeError):
        raise BackupError('Invalid target URL; use a direct PostgreSQL URL with verified TLS.') from None


def target_identity(env):
    raw = env.get('STACKARR_PG_BACKUP_URL')
    if not raw:
        return None
    params = target_parameters(raw)
    scope = [str(params['host']).lower(), params['port'], params['dbname'], params['user']]
    return hashlib.sha256(json.dumps(scope, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def matching_status(env, status):
    return status if status.get('targetIdentity') == target_identity(env) else {}


def utcnow():
    return datetime.now(timezone.utc)


def iso(value=None):
    return (value or utcnow()).isoformat()


def schedule(env, now=None):
    """Most recent actual local schedule instant, plus next. DST folds run once."""
    now = now or utcnow()
    try:
        zone = ZoneInfo(env.get('STACKARR_PG_BACKUP_TIMEZONE', 'Etc/UTC'))
        mode = env.get('STACKARR_PG_BACKUP_SCHEDULE', 'daily')
        value = env.get('STACKARR_PG_BACKUP_TIME', '03:00')
        day = env.get('STACKARR_PG_BACKUP_WEEKDAY', 'Sun')
        if mode not in ('daily', 'weekly') or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
            raise ValueError()
        weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].index(day)
        hour, minute = map(int, value.split(':'))
        dates = []
        for offset in range(-15, 16):
            local = datetime.combine(now.astimezone(zone).date() + timedelta(days=offset), datetime.min.time()).replace(
                hour=hour, minute=minute, tzinfo=zone, fold=0)
            if mode == 'weekly' and local.weekday() != weekday:
                continue
            candidate = local.astimezone(timezone.utc)
            # Skip nonexistent spring-forward times. A fall-back fold uses the first occurrence.
            if candidate.astimezone(zone).replace(tzinfo=None) == local.replace(tzinfo=None):
                dates.append(candidate)
        return max(d for d in dates if d <= now), min(d for d in dates if d > now)
    except (ValueError, KeyError):
        raise BackupError('Invalid backup schedule, time, weekday or timezone.') from None


def due(env, status, now=None):
    now = now or utcnow()
    if env.get('STACKARR_PG_BACKUP_ENABLED') != 'true':
        return False
    status = matching_status(env, status)
    previous, _ = schedule(env, now)
    try:
        success = datetime.fromisoformat(status.get('lastSuccess') or '1970-01-01T00:00:00+00:00')
        attempt = datetime.fromisoformat(status.get('lastAttempt') or '1970-01-01T00:00:00+00:00')
        return success < previous and (now - attempt).total_seconds() >= 3600
    except (ValueError, TypeError):
        raise BackupError('Invalid local backup status; inspect the saved status file.') from None


def private_directory(path):
    if not path.is_absolute() or '..' in path.parts:
        raise BackupError('An absolute private directory is required.')
    for item in [*reversed(path.parents), path]:
        if item.is_symlink():
            raise BackupError('Symlinked backup paths are not supported.')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def read_status(root):
    file = root / 'status.json'
    if not file.exists():
        return {}
    if file.is_symlink() or file.stat().st_size > CHUNK:
        raise BackupError('Unsafe backup status file.')
    try:
        data = json.loads(file.read_text())
        if not isinstance(data, dict):
            return {}
        if data.get('state') == 'running':
            try:
                with (root / 'active.lock').open('r') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return data
            except FileNotFoundError:
                pass
            data.update(state='failed', lastError='Previous PostgreSQL backup stopped before completion.')
        return data
    except (ValueError, OSError):
        raise BackupError('Could not read local backup status.') from None


def write_status(root, status):
    private_directory(root)
    with tempfile.NamedTemporaryFile(mode='w', dir=root, delete=False) as file:
        json.dump(status, file, sort_keys=True)
        file.flush()
        os.fsync(file.fileno())
    os.replace(file.name, root / 'status.json')


def bounded(command, input_data=None, output=None, timeout=900, input_file=None):
    """Never surface child stderr: SQL/tool failures can contain secrets/data."""
    child = subprocess.Popen(command, stdin=input_file or subprocess.PIPE, stdout=output or subprocess.PIPE,
                             stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        stdout, _ = child.communicate(input=input_data, timeout=timeout)
        if child.returncode:
            raise BackupError('PostgreSQL native command failed; no recovery point was promoted.')
        return stdout
    except BaseException:
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=3)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        raise


def conninfo_db(name):
    return "dbname='" + name.replace('\\', '\\\\').replace("'", "\\'") + "'"


class Source:
    def __init__(self, env):
        self.container = env.get('STACKARR_PG_BACKUP_SOURCE_CONTAINER', '')
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', self.container):
            raise BackupError('Managed PostgreSQL source container is required.')
        self.user = env.get('DATABASE_SUPERUSER', 'postgres')
        self.maintenance = env.get('DATABASE_NAME', 'postgres')

    def execute(self, tool, args, **kwargs):
        # Track the actual remote timeout process, not the docker exec client.
        # This private PID receipt is control metadata, never backup bulk data.
        token = uuid.uuid4().hex
        receipt = '/tmp/stackarr-backup-' + token + '.pid'
        command = ['docker', 'exec', '-i', self.container, 'sh', '-c',
                   'umask 077; receipt="$1"; shift; export PGPASSWORD="${POSTGRES_PASSWORD:-}"; '
                   'exec 3<&0; timeout -k 5 900 "$@" <&3 & child=$!; printf "%s\\n" "$child" > "$receipt"; '
                   'trap \'kill -TERM "$child" 2>/dev/null || :\' TERM INT; '
                   'wait "$child"; result=$?; rm -f "$receipt"; exit "$result"',
                   'stackarr-backup', receipt, tool, *args]
        try:
            return bounded(command, **kwargs)
        except BaseException:
            # Receipt names are generated internally. Verify the PID still names
            # our timeout before signaling, and never signal a PostgreSQL server.
            cleanup = ['docker', 'exec', self.container, 'sh', '-c',
                       'test -f "$1" || exit 0; read -r pid < "$1"; '
                       'case "$pid" in ""|*[!0-9]*) exit 1;; esac; '
                       'test "$(cat /proc/"$pid"/comm 2>/dev/null)" = timeout || exit 0; '
                       'kill -TERM "$pid"; rm -f "$1"', 'stackarr-cancel', receipt]
            try:
                subprocess.run(cleanup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            except subprocess.TimeoutExpired:
                pass  # Server-side 900-second deadline remains an independent backstop.
            raise

    def query(self, sql, database=None):
        args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', self.user, '-d', conninfo_db(database or self.maintenance)]
        result = self.execute('psql', args, input_data=sql.encode(), timeout=60)
        try:
            return json.loads(result)
        except (ValueError, TypeError):
            raise BackupError('Invalid source inventory response.') from None

    def globals_fingerprint(self):
        # Compare complete global catalogs without returning role password hashes.
        return self.query("""SELECT to_json(md5(
          (SELECT coalesce(string_agg(row_to_json(r)::text, '' ORDER BY rolname),'') FROM pg_authid r) ||
          (SELECT coalesce(string_agg(row_to_json(m)::text, '' ORDER BY roleid,member,grantor),'') FROM pg_auth_members m) ||
          (SELECT coalesce(string_agg(row_to_json(s)::text, '' ORDER BY spcname),'') FROM pg_tablespace s) ||
          (SELECT coalesce(string_agg(row_to_json(d)::text, '' ORDER BY setdatabase,setrole),'') FROM pg_db_role_setting d)
        ));""")

    def inventory(self):
        summary = self.query("""SELECT json_build_object(
          'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
          'version',current_setting('server_version'), 'versionNum',current_setting('server_version_num')::int,
          'startedAt',pg_postmaster_start_time(),
          'databases',(SELECT json_agg(json_build_object('name',datname,'allowConnections',datallowconn,
            'bytes',pg_database_size(oid),'encoding',pg_encoding_to_char(encoding),'collation',datcollate,'ctype',datctype,'isTemplate',datistemplate,
            'owner',pg_get_userbyid(datdba),'acl',datacl))
            FROM pg_database WHERE datname <> 'template0'));""")
        databases = summary.get('databases') or []
        if not databases or len(databases) > MAX_DATABASES or any(not d['allowConnections'] for d in databases):
            raise BackupError('Every source database except template0 must be connectable; inventory incomplete.')
        for db in sorted(databases, key=lambda d: d['name']):
            details = self.query("""SELECT json_build_object(
              'schemas',ARRAY(SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' ORDER BY 1),
              'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion,'schema',nspname))
                  FROM pg_extension JOIN pg_namespace ON extnamespace=pg_namespace.oid),
              'largeObjects',(SELECT count(*) FROM pg_largeobject_metadata));""", db['name'])
            db.update(details)
        summary['databases'] = sorted(databases, key=lambda d: d['name'])
        summary['globalsFingerprint'] = self.globals_fingerprint()
        return summary

    def capture(self, directory, inventory):
        artifacts = []
        def dump(filename, tool, args, database=None):
            file = directory / filename
            started = iso()
            with file.open('xb') as out:
                self.execute(tool, args, output=out)
                out.flush()
                os.fsync(out.fileno())
            size = file.stat().st_size
            if not size:
                raise BackupError('Native dump is empty; no recovery point was promoted.')
            if tool == 'pg_dump' and file.open('rb').read(5) != b'PGDMP':
                raise BackupError('Native dump format is invalid.')
            digest = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()
            artifacts.append(dict(file=filename, database=database, bytes=size, sha256=digest,
                                  startedAt=started, finishedAt=iso()))
        dump('globals.sql', 'pg_dumpall', ['-w', '-U', self.user, '--globals-only', '-l', conninfo_db(self.maintenance)])
        for index, db in enumerate(inventory['databases']):
            # Numeric filenames avoid path/name collisions, traversal and Unicode filesystem ambiguity.
            dump(f'database-{index:04d}.dump', 'pg_dump',
                 ['-w', '-U', self.user, '-d', conninfo_db(db['name']), '-Fc', '-Z6', '--create'], db['name'])
        after = self.query("SELECT json_agg(datname ORDER BY datname) FROM pg_database WHERE datname <> 'template0';")
        if after != [d['name'] for d in inventory['databases']]:
            raise BackupError('Source database inventory changed during capture; retry required.')
        if self.globals_fingerprint() != inventory['globalsFingerprint']:
            raise BackupError('Source roles or global settings changed during capture; retry required.')
        return artifacts


@contextmanager
def target(raw):
    import psycopg2
    params = target_parameters(raw)
    # Explicit kwargs plus removal of libpq environment prevents service/options overrides.
    old = {k: v for k, v in os.environ.items() if k.startswith('PG')}
    for k in old:
        del os.environ[k]
    connection = None
    try:
        connection = psycopg2.connect(**params)
        yield connection
    finally:
        if connection:
            connection.close()
        os.environ.update(old)


def preflight(connection, inventory, claim=False):
    """A dedicated DB owned by this role, empty or marked for this exact estate."""
    with connection.cursor() as cur:
        cur.execute('SELECT current_database(), current_user, pg_get_userbyid(datdba), current_setting(\'server_version_num\')::int FROM pg_database WHERE datname=current_database()')
        name, user, owner, version = cur.fetchone()
        if name in [d['name'] for d in inventory['databases']]:
            raise BackupError('Target database name overlaps the source estate; use a separate dedicated database.')
        if user != owner or version < 140000:
            raise BackupError('Target requires PostgreSQL 14+ and a database-owner role.')
        # Compare immutable cluster IDs, not postmaster uptime (which changes on
        # restart). Neon is independently identified by its verify-full TLS host.
        cur.execute("SELECT has_function_privilege(current_user,'pg_control_system()','EXECUTE')")
        if cur.fetchone()[0]:
            cur.execute('SELECT system_identifier::text FROM pg_control_system()')
            if cur.fetchone()[0] == inventory['systemIdentifier']:
                raise BackupError('Target is the source PostgreSQL cluster; refusing to write.')
        elif not re.fullmatch(r'[a-zA-Z0-9.-]+\.neon\.tech', connection.info.host or ''):
            raise BackupError('Target identity unavailable: grant the backup owner EXECUTE on pg_control_system(), or use a verified Neon endpoint.')
        cur.execute('SELECT pg_try_advisory_xact_lock(748154, 1)')
        if not cur.fetchone()[0]:
            raise BackupError('Another PostgreSQL backup owns the destination lock.')
        cur.execute("SELECT nspname, pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'")
        schemas = dict(cur.fetchall())
        if set(schemas) - {'public', SCHEMA}:
            raise BackupError('Target is not a dedicated empty backup database.')
        cur.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")
        if cur.fetchone()[0]:
            raise BackupError('Target contains unrelated public objects; nothing was changed.')
        cur.execute("SELECT count(*) FROM pg_depend WHERE refclassid='pg_namespace'::regclass AND refobjid='public'::regnamespace")
        if cur.fetchone()[0]:
            raise BackupError('Target contains unrelated public objects; nothing was changed.')
        cur.execute('SELECT count(*) FROM pg_event_trigger')
        if cur.fetchone()[0]:
            raise BackupError('Target contains unrelated event triggers.')
        cur.execute("SELECT extname,extversion FROM pg_extension ORDER BY extname")
        extensions = cur.fetchall()
        if any(name != 'plpgsql' for name, _ in extensions):
            raise BackupError('Target contains unrelated extensions; use a dedicated database.')
        cur.execute('SELECT count(*) FROM pg_largeobject_metadata')
        if cur.fetchone()[0]:
            raise BackupError('Target contains unrelated large objects.')
        if SCHEMA in schemas:
            if schemas[SCHEMA] != user:
                raise BackupError('Backup schema owner does not match the target role.')
            cur.execute('SELECT owner,format FROM stackarr_backup_v1.identity WHERE singleton=true')
            if cur.fetchall() != [(inventory['systemIdentifier'], FORMAT)]:
                raise BackupError('Destination ownership marker does not match this source estate.')
        elif claim:
            cur.execute('CREATE SCHEMA stackarr_backup_v1')
            cur.execute('REVOKE ALL ON SCHEMA stackarr_backup_v1 FROM PUBLIC')
            cur.execute('''CREATE TABLE stackarr_backup_v1.identity (singleton boolean PRIMARY KEY CHECK(singleton), owner text NOT NULL, format integer NOT NULL, current_generation uuid);
              CREATE TABLE stackarr_backup_v1.generations (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), manifest jsonb NOT NULL);
              CREATE TABLE stackarr_backup_v1.chunks (generation uuid NOT NULL REFERENCES stackarr_backup_v1.generations(id) ON DELETE CASCADE, artifact integer NOT NULL, ordinal integer NOT NULL, data bytea NOT NULL, PRIMARY KEY(generation,artifact,ordinal));''')
            cur.execute('INSERT INTO stackarr_backup_v1.identity(singleton,owner,format) VALUES(true,%s,%s)', (inventory['systemIdentifier'], FORMAT))
        cur.execute('SELECT name,default_version FROM pg_available_extensions ORDER BY name')
        available = dict(cur.fetchall())
        return dict(versionNum=version, requiredDatabases=1, mode='native-archive-not-queryable',
                    queryableExtensionGaps=sorted({e['name'] + '@' + e['version'] for d in inventory['databases'] for e in d['extensions']
                                                  if available.get(e['name']) != e['version']}))


def binary_copy_row(fields):
    return struct.pack('!h', len(fields)) + b''.join(struct.pack('!i', len(f)) + f for f in fields)


class ChunkCopy(io.RawIOBase):
    """Bounded binary COPY stream, never a row-by-row network upload."""
    def __init__(self, directory, manifest):
        self.iterator = self.rows(directory, manifest)
        self.pending = b''

    @staticmethod
    def rows(directory, manifest):
        yield b'PGCOPY\n\xff\r\n\0' + struct.pack('!ii', 0, 0)
        for index, artifact in enumerate(manifest['artifacts']):
            with (directory / artifact['file']).open('rb') as file:
                ordinal = 0
                while data := file.read(CHUNK):
                    yield binary_copy_row([uuid.UUID(manifest['generation']).bytes, struct.pack('!i', index), struct.pack('!i', ordinal), data])
                    ordinal += 1
        yield struct.pack('!h', -1)

    def read(self, size=-1):
        size = CHUNK if size < 0 else size
        while len(self.pending) < size:
            try:
                self.pending += next(self.iterator)
            except StopIteration:
                break
        result, self.pending = self.pending[:size], self.pending[size:]
        return result


def verify_remote(cur, manifest, output=None):
    for index, artifact in enumerate(manifest['artifacts']):
        digest, size, expected = hashlib.sha256(), 0, 0
        file = (output / artifact['file']).open('xb') if output else None
        try:
            # Per-chunk fetch keeps driver memory bounded even for multi-GB archives.
            while True:
                cur.execute('SELECT data FROM stackarr_backup_v1.chunks WHERE generation=%s AND artifact=%s AND ordinal=%s',
                            (manifest['generation'], index, expected))
                row = cur.fetchone()
                if row is None:
                    break
                data = bytes(row[0])
                if len(data) > CHUNK:
                    raise BackupError('Remote backup chunk exceeds the format limit.')
                digest.update(data)
                size += len(data)
                expected += 1
                if size > artifact['bytes']:
                    raise BackupError('Remote backup contains unexpected bytes.')
                if file:
                    file.write(data)
            if digest.hexdigest() != artifact['sha256'] or size != artifact['bytes']:
                raise BackupError('Remote backup checksum verification failed.')
            cur.execute('SELECT count(*) FROM stackarr_backup_v1.chunks WHERE generation=%s AND artifact=%s', (manifest['generation'], index))
            if cur.fetchone()[0] != expected:
                raise BackupError('Remote backup chunk inventory is incomplete.')
            if file:
                file.flush()
                os.fsync(file.fileno())
        finally:
            if file:
                file.close()


def publish(connection, directory, manifest):
    validate_manifest(manifest)
    preflight(connection, manifest['source'], claim=True)
    with connection.cursor() as cur:
        cur.execute('SELECT current_generation FROM stackarr_backup_v1.identity WHERE singleton=true FOR UPDATE')
        previous = cur.fetchone()[0]
        cur.execute('INSERT INTO stackarr_backup_v1.generations(id,manifest) VALUES(%s,%s::jsonb)',
                    (manifest['generation'], json.dumps(manifest)))
        cur.copy_expert('COPY stackarr_backup_v1.chunks(generation,artifact,ordinal,data) FROM STDIN WITH (FORMAT binary)', ChunkCopy(directory, manifest))
        verify_remote(cur, manifest)
        cur.execute('UPDATE stackarr_backup_v1.identity SET current_generation=%s WHERE singleton=true', (manifest['generation'],))
        cur.execute('DELETE FROM stackarr_backup_v1.generations WHERE id <> %s AND (%s::uuid IS NULL OR id <> %s::uuid)',
                    (manifest['generation'], previous, previous))
    connection.commit()


def validate_manifest(manifest):
    try:
        if manifest['format'] != FORMAT:
            raise ValueError()
        uuid.UUID(manifest['generation'])
        artifacts = manifest['artifacts']
        if not isinstance(artifacts, list) or not 1 < len(artifacts) <= MAX_DATABASES + 1:
            raise ValueError()
        if artifacts[0]['file'] != 'globals.sql' or artifacts[0]['database'] is not None:
            raise ValueError()
        for i, artifact in enumerate(artifacts):
            if artifact['file'] != ('globals.sql' if i == 0 else f'database-{i-1:04d}.dump'):
                raise ValueError()
            if type(artifact['bytes']) is not int or not 0 < artifact['bytes'] < 1024 ** 5:
                raise ValueError()
            if not re.fullmatch('[a-f0-9]{64}', artifact['sha256']):
                raise ValueError()
        if [a['database'] for a in artifacts[1:]] != [d['name'] for d in manifest['source']['databases']]:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        raise BackupError('Remote recovery manifest is invalid.') from None


def export_backup(connection, directory, previous=False):
    # Export deliberately does not require a working source server or matching installation UUID.
    with connection.cursor() as cur:
        cur.execute('SELECT format,current_generation FROM stackarr_backup_v1.identity WHERE singleton=true')
        rows = cur.fetchall()
        if len(rows) != 1 or rows[0][0] != FORMAT or not rows[0][1]:
            raise BackupError('No published recovery point is available.')
        generation = rows[0][1]
        if previous:
            cur.execute('SELECT id FROM stackarr_backup_v1.generations WHERE id <> %s ORDER BY created_at DESC LIMIT 1', (generation,))
            row = cur.fetchone()
            if not row:
                raise BackupError('No previous recovery point is available.')
            generation = row[0]
        cur.execute('SELECT manifest FROM stackarr_backup_v1.generations WHERE id=%s', (generation,))
        row = cur.fetchone()
        if not row:
            raise BackupError('Published recovery point is missing.')
        manifest = row[0]
        validate_manifest(manifest)
        if str(generation) != manifest['generation']:
            raise BackupError('Published recovery point identity does not match its manifest.')
        verify_remote(cur, manifest, directory)
        (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['status', 'test', 'run', 'run-due', 'export', 'due'])
    parser.add_argument('--output')
    parser.add_argument('--previous', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    env = os.environ
    root = Path(env.get('STATE_ROOT', '')) / 'postgres-backup'
    if not root.is_absolute():
        raise BackupError('STATE_ROOT is required.')
    status = matching_status(env, read_status(root))
    if args.operation == 'status':
        print(json.dumps(status))
        return
    if args.operation == 'due':
        sys.exit(0 if due(env, status) else 3)
    if args.operation == 'run-due' and not due(env, status):
        return
    private_directory(root)
    with (root / 'active.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError('A PostgreSQL backup job is already active.') from None
        def cancel(_signal, _frame):
            raise BackupError('PostgreSQL backup cancelled or timed out; last published recovery point is preserved.')
        signal.signal(signal.SIGTERM, cancel)
        signal.signal(signal.SIGINT, cancel)
        signal.signal(signal.SIGALRM, cancel)
        signal.alarm(JOB_SECONDS)
        raw = env.get('STACKARR_PG_BACKUP_URL', '')
        target_parameters(raw)
        status['targetIdentity'] = target_identity(env)
        started = time.monotonic()
        if args.operation in ('run', 'run-due'):
            status.update(state='running', lastAttempt=iso(), lastError=None)
            write_status(root, status)
        try:
            if args.operation == 'export':
                if not args.output or not Path(args.output).is_absolute() or Path(args.output).exists():
                    raise BackupError('Export requires a new absolute output directory.')
                output = Path(args.output)
                backup_root = Path(env.get('BACKUP_ROOT', ''))
                if not backup_root.is_absolute() or not output.is_relative_to(backup_root) or output == backup_root:
                    raise BackupError('Export output must be beneath the verified backup root.')
                private_directory(output.parent)
                stage = Path(tempfile.mkdtemp(prefix='.postgres-export-', dir=output.parent))
                try:
                    with target(raw) as connection:
                        connection.set_session(isolation_level='REPEATABLE READ', readonly=True)
                        manifest = export_backup(connection, stage, args.previous)
                    os.rename(stage, output)
                    print(json.dumps(dict(exported=True, generation=manifest['generation'], databases=len(manifest['source']['databases']))))
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)
                return
            source = Source(env)
            inventory = source.inventory()
            with target(raw) as connection:
                capabilities = preflight(connection, inventory)
            coverage = [dict(name=d['name'], schema=', '.join(d['schemas']), extensions=[e['name'] + '@' + e['version'] for e in d['extensions']]) for d in inventory['databases']]
            if args.operation == 'test':
                status.update(lastTest=iso(), coverage=coverage, preflight=capabilities, lastError=None)
                write_status(root, status)
                print(json.dumps(dict(tested=True, coverage=coverage, target=capabilities)))
                return
            staging = Path(env.get('BACKUP_STAGING_ROOT') or str(Path(env['BACKUP_ROOT']) / '.stackarr-staging'))
            private_directory(staging)
            with tempfile.TemporaryDirectory(prefix='postgres-backup-', dir=staging) as name:
                directory = Path(name)
                artifacts = source.capture(directory, inventory)
                manifest = dict(format=FORMAT, generation=str(uuid.uuid4()), createdAt=iso(),
                                stackarrVersion=env.get('STACKARR_VERSION', 'unknown'), source=inventory, artifacts=artifacts,
                                mode='native-archive', consistency='per-database snapshot; not a cross-database transaction')
                with target(raw) as connection:
                    publish(connection, directory, manifest)
                status.update(state='succeeded', lastSuccess=iso(), lastError=None, generation=manifest['generation'],
                              coverage=coverage, bytes=sum(a['bytes'] for a in artifacts),
                              durationSeconds=round(time.monotonic()-started, 3), preflight=capabilities)
                write_status(root, status)
                print(json.dumps(dict(state='succeeded', generation=status['generation'], bytes=status['bytes'], databases=len(coverage))))
        except BaseException as exc:
            message = str(exc) if isinstance(exc, BackupError) else 'PostgreSQL backup failed; check connection, capacity and native engine compatibility.'
            status.update(state='failed', lastError=message)
            write_status(root, status)
            raise BackupError(message) from None
        finally:
            signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, BackupError) else 'PostgreSQL backup failed.', file=sys.stderr)
        sys.exit(1)
