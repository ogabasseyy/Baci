"""Read-only active-generation resolution for the isolated extractor."""
from __future__ import annotations

import os
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_archive_extract_launcher as launcher


class ArchiveGenerationLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temp.name)
        self.uid, self.gid = os.getuid(), os.getgid()
        self.helper = self.root / "helper"
        self.pointer = self.root / "state" / "pointer"
        (self.helper / "generations").mkdir(parents=True, mode=0o755)
        self.pointer.mkdir(parents=True, mode=0o711)
        generation = self.helper / "generations" / ("0" * 64)
        generation.mkdir(mode=0o755)
        files = []
        for name in ("worker_release_archive_extract_child.py", "worker_release_archive.py",
                     "worker_release_broker_common.py"):
            content = b"# fixed test file\n"
            (generation / name).write_bytes(content)
            os.chmod(generation / name, 0o440)
            files.append({"path": name, "mode": 0o440, "gid": self.gid,
                          "size": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        files.sort(key=lambda entry: entry["path"])
        canonical = json.dumps({"version": 1, "files": files}, sort_keys=True,
                               separators=(",", ":")).encode()
        self.digest = hashlib.sha256(canonical).hexdigest()
        generation.rename(generation.parent / self.digest)
        generation = generation.parent / self.digest
        manifest = {"version": 1, "digest": self.digest, "files": files}
        (generation / "generation.json").write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
        os.chmod(generation / "generation.json", 0o444)
        os.chmod(generation, 0o555)
        os.symlink(str(generation), self.pointer / "current")

    def tearDown(self):
        for current, _directories, _files in os.walk(self.root, topdown=True):
            os.chmod(current, 0o700)
        self.temp.cleanup()

    def resolve(self):
        return launcher.resolve_generation(helper_root=self.helper, pointer_root=self.pointer,
                                           owner_uid=self.uid, owner_gid=self.gid,
                                           extractor_gid=self.gid)

    def test_selects_only_canonical_active_generation_with_fixed_readable_closure(self):
        digest, child = self.resolve()
        self.assertEqual(digest, self.digest)
        self.assertEqual(child, str(self.helper / "generations" / self.digest /
                                    "worker_release_archive_extract_child.py"))

    def test_rejects_noncanonical_target_or_wrong_group_mode(self):
        (self.pointer / "current").unlink()
        (self.pointer / "current").symlink_to(str(self.helper / "generations" / "../outside"))
        with self.assertRaisesRegex(RuntimeError, "pointer is invalid"):
            self.resolve()
        (self.pointer / "current").unlink()
        generation = self.helper / "generations" / self.digest
        (self.pointer / "current").symlink_to(str(generation))
        child = generation / "worker_release_archive.py"
        os.chmod(child, 0o400)
        with self.assertRaisesRegex(RuntimeError, "differs from its manifest"):
            self.resolve()

    def test_launcher_arguments_are_bounded_and_environment_is_sanitized(self):
        args = ["e" * 32]
        child = str(self.helper / "generations" / self.digest /
                    "worker_release_archive_extract_child.py")
        with patch.object(launcher, "resolve_generation", return_value=(self.digest, child)):
            executable, argv, environment = launcher.command(args)
        self.assertEqual(executable, "/usr/bin/python3")
        self.assertEqual(argv, ["/usr/bin/python3", "-I", "-B",
                                child, args[0]])
        self.assertEqual(environment, {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        with self.assertRaisesRegex(RuntimeError, "transaction identity"):
            launcher.command(["../bad"])


if __name__ == "__main__":
    unittest.main()
