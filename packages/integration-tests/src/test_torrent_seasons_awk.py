"""Zero-install classifier contract tests; Python is only the test driver."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
HOOK = ROOT / "stackarr/scripts/hooks/torrent-seasons.sh"
PYTHON = ROOT / "stackarr/scripts/hooks/torrent-seasons.py"


def b(value):
    if isinstance(value, int):
        return b"i" + str(value).encode() + b"e"
    if isinstance(value, bytes):
        return str(len(value)).encode() + b":" + value
    if isinstance(value, list):
        return b"l" + b"".join(map(b, value)) + b"e"
    return b"d" + b"".join(b(k) + b(value[k]) for k in sorted(value)) + b"e"


def v1(paths):
    return b({b"info": {b"name": b"Show", b"files": [
        {b"length": 1, b"path": [x.encode() for x in path]} for path in paths]}})


def tree(paths):
    result = {}
    for path in paths:
        node = result
        for part in path:
            node = node.setdefault(part.encode(), {})
        node[b""] = {b"length": 1}
    return result


class TestTorrentSeasonsAwk(unittest.TestCase):
    def check(self, payload, expected, evidence=False):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "fixture.torrent"
            path.write_bytes(payload)
            args = [str(path)] + (["--single-evidence"] if evidence else [])
            result = subprocess.run(["sh", str(HOOK), *args], capture_output=True, text=True, check=True)
            self.assertEqual(result.stderr, "")
            self.assertEqual(result.stdout, expected + "\n")
            py = subprocess.run(["python3", str(PYTHON), *args], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout, py.stdout)

    def test_v1_and_evidence(self):
        self.check(v1([["Season 01", "S01E02.mkv"], ["Season 01", "S01E03.mp4"]]), "single 1")
        self.check(v1([["S01E02.mkv"], ["S02E01.mkv"]]), "multi")
        self.check(v1([["S01E02.mkv"], ["mystery.mkv"]]), "unknown")
        self.check(v1([["mystery.mkv"]]), "one unknown", True)
        self.check(v1([["Season 04", "mystery.webm"]]), "single 4")
        self.check(v1([["Season 04", "S05E01.mkv"]]), "unknown")
        self.check(v1([["mystery.txt"]]), "unknown")
        self.check(v1([["1x02.mkv"]]), "single 1")
        self.check(v1([["S03", "clip.mkv"]]), "single 3")
        self.check(v1([["../escape.mkv"]]), "unknown")
        self.check(v1([["Season 03", "clip.mkv"], ["Season 04", "clip.mkv"]]), "multi")
        self.check(b({b"info": {b"length": 1, b"name": b"S05E01.mkv"}}), "single 5")

    def test_v2_hybrid_padding_and_blob(self):
        paths = [["Season 2", "S02E01.mkv"], ["Season 2", "S02E02.mkv"]]
        base = {b"name": b"Show", b"meta version": 2, b"file tree": tree(paths)}
        self.check(b({b"info": base}), "single 2")
        single = {b"name": b"S02E01.mkv", b"length": 1,
                  b"meta version": 2, b"file tree": tree([["S02E01.mkv"]])}
        self.check(b({b"info": single}), "single 2")
        base[b"files"] = [{b"length": 1, b"path": [x.encode() for x in p]} for p in paths]
        base[b"pieces"] = b"\0" * (1024 * 1024)
        self.check(b({b"announce": b"https://tracker.invalid/secret", b"info": base}), "single 2")
        base[b"files"][1][b"path"] = [b"S03E02.mkv"]
        self.check(b({b"info": base}), "unknown")
        base[b"files"][1][b"path"] = [x.encode() for x in paths[1]]
        base[b"files"].append({b"attr": b"p", b"length": 1, b"path": [b".pad", b"padding.mkv"]})
        self.check(b({b"info": base}), "single 2")

    def test_malformed(self):
        for payload in (b"", b"d4:infod4:name4:Showe", b"d4:infod4:name4:Showeejunk",
                        b"d4:infod4:name3:..e5:fileslee", b"d4:infod4:name4:Show5:fileslee"):
            self.check(payload, "unknown")
        self.check(b({b"info": {b"name": b"Show", b"files": [
            {b"length": 1, b"path": [b"..", b"S01E01.mkv"]}]}}), "unknown")
        self.check(b({b"info": {b"name": b"Show", b"files": [
            {b"length": 1, b"path": [b"Season 01", b"S01E01.mkv"]}],
            b"pieces": b"x" * (32 * 1024 * 1024)}}), "unknown")


if __name__ == "__main__":
    unittest.main()
