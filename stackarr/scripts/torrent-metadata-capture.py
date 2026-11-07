#!/usr/bin/env python3
"""Copy completed client metainfo to a private, hash-addressed source cache.

Run in the controller (Python 3), with read-only client-state mounts. This does
not query clients, start downloads, modify their state, or publish library files.
Transmission source: libtransmission/torrent-magnet.cc use_new_metainfo() saves
`torrent_file()` after verifying the downloaded info SHA-1; before that the
store_file() in torrent.cc is a magnet, not a completed torrent.
"""

import argparse
import hashlib
import itertools
import os
from pathlib import Path
import re
import stat
import time

MAX_TORRENT_BYTES = 16 * 1024 * 1024
MAX_DEPTH = 32
MAX_ITEMS = 100000
HASH_NAME = re.compile(r"(?i)(?:^|\.)([0-9a-f]{40}|[0-9a-f]{64})\.torrent$")


class Unready(ValueError):
    """Invalid, incomplete, or mismatched metainfo: retry on a later pass."""


class Decoder:
    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.items = 0
        self.info_span = None

    def value(self, depth=0, root=False):
        self.items += 1
        if self.items > MAX_ITEMS or depth > MAX_DEPTH or self.pos >= len(self.data):
            raise Unready('bencode bounds')
        data = self.data
        token = data[self.pos:self.pos + 1]
        self.pos += 1
        if token == b'i':
            end = data.find(b'e', self.pos)
            if end < 0 or end - self.pos > 20:
                raise Unready('integer')
            raw = data[self.pos:end]
            if not re.fullmatch(rb'(0|-?[1-9][0-9]*)', raw) or raw == b'-0':
                raise Unready('integer')
            self.pos = end + 1
            return int(raw)
        if token.isdigit():
            self.pos -= 1
            colon = data.find(b':', self.pos, min(len(data), self.pos + 12))
            if colon < 0:
                raise Unready('string length')
            raw = data[self.pos:colon]
            if not re.fullmatch(rb'(0|[1-9][0-9]*)', raw):
                raise Unready('string length')
            size = int(raw)
            self.pos = colon + 1
            if size > len(data) - self.pos:
                raise Unready('truncated string')
            result = data[self.pos:self.pos + size]
            self.pos += size
            return result
        if token in (b'l', b'd'):
            result_list = []
            result_dict = {}
            previous = None
            while True:
                if self.pos >= len(data):
                    raise Unready('unterminated collection')
                if data[self.pos:self.pos + 1] == b'e':
                    self.pos += 1
                    return result_list if token == b'l' else result_dict
                if token == b'l':
                    result_list.append(self.value(depth + 1))
                else:
                    key = self.value(depth + 1)
                    if not isinstance(key, bytes) or (previous is not None and key <= previous):
                        raise Unready('unordered or duplicate key')
                    previous = key
                    start = self.pos
                    result_dict[key] = self.value(depth + 1)
                    if root and key == b'info':
                        self.info_span = (start, self.pos)
        raise Unready('invalid token')


def torrent_hashes(data):
    """Return verified v1/v2 infohashes; never hash re-encoded dictionaries."""
    if not data or len(data) > MAX_TORRENT_BYTES:
        raise Unready('torrent size')
    decoder = Decoder(data)
    top = decoder.value(root=True)
    if decoder.pos != len(data) or not isinstance(top, dict) or not decoder.info_span:
        raise Unready('torrent structure')
    info = top[b'info']
    if not isinstance(info, dict) or not isinstance(info.get(b'name'), bytes) or not info[b'name']:
        raise Unready('info name')
    piece_length = info.get(b'piece length')
    if not isinstance(piece_length, int) or piece_length <= 0:
        raise Unready('piece length')
    raw = data[slice(*decoder.info_span)]
    version = info.get(b'meta version')
    result = set()
    if version is not None and version != 2:
        raise Unready('unsupported meta version')
    if version == 2:
        if not isinstance(info.get(b'file tree'), dict) or not info[b'file tree']:
            raise Unready('v2 file tree')
        result.add(hashlib.sha256(raw).hexdigest().upper())
    if version is None or b'pieces' in info:
        pieces = info.get(b'pieces')
        if not isinstance(pieces, bytes) or not pieces or len(pieces) % 20:
            raise Unready('v1 pieces')
        if not (isinstance(info.get(b'length'), int) and info[b'length'] >= 0 or
                isinstance(info.get(b'files'), list) and bool(info[b'files'])):
            raise Unready('v1 files')
        result.add(hashlib.sha1(raw).hexdigest().upper())
    return result


def directory_fd(path):
    """Walk absolute directories without following symlinks, including parents."""
    path = Path(os.path.abspath(path))
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_source(dirfd, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_TORRENT_BYTES:
            raise Unready('source size/type')
        data = bytearray()
        while len(data) <= MAX_TORRENT_BYTES:
            chunk = os.read(fd, min(65536, MAX_TORRENT_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        if (len(data) != before.st_size or before.st_dev != after.st_dev or
                before.st_ino != after.st_ino or before.st_size != after.st_size or
                before.st_mtime_ns != after.st_mtime_ns):
            raise Unready('source changed')
        return bytes(data)
    finally:
        os.close(fd)


def publish(captured_fd, name, data):
    """No overwrite, including concurrent publishers; existing capture is immutable."""
    def check_existing():
        saved = read_source(captured_fd, name)
        if name[:-8] not in torrent_hashes(saved):
            raise Unready('invalid existing capture')
        return 'existing'

    try:
        return check_existing()
    except FileNotFoundError:
        pass
    temp = '.capture-%d-%d' % (os.getpid(), time.monotonic_ns())
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=captured_fd)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temp, name, src_dir_fd=captured_fd, dst_dir_fd=captured_fd,
                    follow_symlinks=False)
        except FileExistsError:
            return check_existing()
        os.fsync(captured_fd)
        return 'captured'
    finally:
        os.unlink(temp, dir_fd=captured_fd)


def capture_pass(archive_root, transmission_state=None, qbittorrent_state=None):
    """One bounded scan; returns secret-free counters. Missing state is retryable."""
    result = {'captured': 0, 'existing': 0, 'skipped': 0}
    root_fd = directory_fd(archive_root)
    try:
        try:
            os.mkdir('_Captured', 0o700, dir_fd=root_fd)
        except FileExistsError:
            pass
        captured_fd = os.open('_Captured', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                              dir_fd=root_fd)
        try:
            if os.fstat(captured_fd).st_mode & 0o077:
                raise PermissionError('capture directory must be private')
            for state in (transmission_state, qbittorrent_state):
                if state is None:
                    continue
                try:
                    source_fd = directory_fd(state)
                except (FileNotFoundError, NotADirectoryError, OSError):
                    result['skipped'] += 1
                    continue
                try:
                    # A snapshot limits work even if the daemon is updating state.
                    with os.scandir(source_fd) as entries:
                        names = [entry.name for entry in itertools.islice(entries, MAX_ITEMS)]
                    for name in names:
                        match = HASH_NAME.search(name)
                        if not match:
                            continue
                        expected = match.group(1).upper()
                        try:
                            data = read_source(source_fd, name)
                            if expected not in torrent_hashes(data):
                                raise Unready('hash mismatch')
                            outcome = publish(captured_fd, expected + '.torrent', data)
                            result[outcome] += 1
                        except (Unready, OSError):
                            result['skipped'] += 1
                finally:
                    os.close(source_fd)
        finally:
            os.close(captured_fd)
    finally:
        os.close(root_fd)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-root', required=True)
    parser.add_argument('--transmission-state')
    parser.add_argument('--qbittorrent-state')
    parser.add_argument('--passes', type=int, default=1, help='bounded scan count (default: 1)')
    parser.add_argument('--interval', type=float, default=5, help='seconds between passes')
    parser.add_argument('--quiet', action='store_true', help='report only new captures')
    args = parser.parse_args()
    if not 1 <= args.passes <= 720 or not 0 <= args.interval <= 3600 or not (args.transmission_state or args.qbittorrent_state):
        parser.error('provide client state, 1..720 passes, and 0..3600 second interval')
    try:
        for index in range(args.passes):
            counts = capture_pass(args.archive_root, args.transmission_state, args.qbittorrent_state)
            if not args.quiet or counts['captured']:
                print('pass %d: captured=%d existing=%d skipped=%d' %
                      (index + 1, counts['captured'], counts['existing'], counts['skipped']), flush=True)
            if index + 1 < args.passes:
                time.sleep(args.interval)
    except OSError:
        parser.exit(1, 'capture: unavailable archive root or filesystem error\n')


if __name__ == '__main__':
    main()
