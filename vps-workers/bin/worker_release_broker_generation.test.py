"""Filesystem regressions for immutable broker generations."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_broker_generation import (
    BrokerGenerationRejected, GenerationFile, current_generation,
    clear_generation_pointer, publish_generation, switch_generation, verify_generation,
)


class BrokerGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temporary.name)
        self.uid = os.getuid()
        self.gid = os.getgid()
        os.chmod(self.root, 0o755)
        self.files = (
            GenerationFile("worker_release_broker.py", b"broker-v1\n", 0o550, self.gid),
            GenerationFile("bin/dispatcher.mjs", b"dispatcher-v1\n", 0o440, self.gid),
            GenerationFile("lib/policy.mjs", b"policy-v1\n", 0o440, self.gid),
        )

    def tearDown(self):
        for current, directories, _files in os.walk(self.root, topdown=True, followlinks=False):
            os.chmod(current, 0o700)
            for name in directories:
                path = Path(current) / name
                if not path.is_symlink():
                    os.chmod(path, 0o700)
        self.temporary.cleanup()

    def publish(self, files=None):
        return publish_generation(self.root, files or self.files,
                                  owner_uid=self.uid, root_gid=self.gid)

    def test_publishes_complete_frozen_generation_and_switches_exact_pointer(self):
        digest = self.publish()
        self.assertTrue(verify_generation(self.root, digest, owner_uid=self.uid,
                                          root_gid=self.gid))
        self.assertIsNone(current_generation(self.root, owner_uid=self.uid,
                                             root_gid=self.gid))
        switch_generation(self.root, digest, expected_current=None,
                          owner_uid=self.uid, root_gid=self.gid)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid), digest)
        self.assertEqual((self.root / "current").readlink(), Path("generations") / digest)

    def test_refuses_changed_file_extra_member_and_symlinked_member(self):
        digest = self.publish()
        broker = self.root / "generations" / digest / "worker_release_broker.py"
        os.chmod(broker, 0o640)
        broker.write_bytes(b"changed\n")
        with self.assertRaisesRegex(BrokerGenerationRejected, "differs from manifest"):
            verify_generation(self.root, digest, owner_uid=self.uid, root_gid=self.gid)

        self.tearDown()
        self.setUp()
        digest = self.publish()
        extra = self.root / "generations" / digest / "extra.txt"
        os.chmod(extra.parent, 0o755)
        extra.write_text("unexpected")
        os.chmod(extra.parent, 0o555)
        with self.assertRaisesRegex(BrokerGenerationRejected, "members do not match"):
            verify_generation(self.root, digest, owner_uid=self.uid, root_gid=self.gid)

        self.tearDown()
        self.setUp()
        digest = self.publish()
        generation_root = self.root / "generations" / digest
        os.chmod(generation_root, 0o755)
        broker = generation_root / "worker_release_broker.py"
        broker.unlink()
        broker.symlink_to("/tmp/untrusted")
        os.chmod(generation_root, 0o555)
        with self.assertRaisesRegex(BrokerGenerationRejected, "link or special file"):
            verify_generation(self.root, digest, owner_uid=self.uid, root_gid=self.gid)

    def test_rejects_stale_switch_fence_and_noncanonical_current_link(self):
        first = self.publish()
        second = self.publish(tuple(GenerationFile(item.path, item.content + b"v2\n",
                                                   item.mode, item.gid) for item in self.files))
        switch_generation(self.root, first, expected_current=None,
                          owner_uid=self.uid, root_gid=self.gid)
        with self.assertRaisesRegex(BrokerGenerationRejected, "changed during switch"):
            switch_generation(self.root, second, expected_current=None,
                              owner_uid=self.uid, root_gid=self.gid)
        os.unlink(self.root / "current")
        os.symlink("generations/../other", self.root / "current")
        with self.assertRaisesRegex(BrokerGenerationRejected, "not canonical"):
            current_generation(self.root, owner_uid=self.uid, root_gid=self.gid)

    def test_existing_generation_is_idempotent_but_content_collision_cannot_overwrite(self):
        digest = self.publish()
        self.assertEqual(self.publish(), digest)
        changed = tuple(GenerationFile(item.path, item.content + b"changed\n",
                                       item.mode, item.gid) for item in self.files)
        self.assertNotEqual(self.publish(changed), digest)

    def test_mutable_pointer_can_be_isolated_from_readonly_generation_root(self):
        digest = self.publish()
        state = self.root / "state"
        state.mkdir(mode=0o700)
        switch_generation(self.root, digest, expected_current=None, owner_uid=self.uid,
                          root_gid=self.gid, state_root=state)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid, state_root=state), digest)
        self.assertEqual((state / "current").readlink(),
                         self.root / "generations" / digest)
        self.assertFalse((self.root / "current").exists())
        clear_generation_pointer(self.root, expected_current=digest, owner_uid=self.uid,
                                 root_gid=self.gid, state_root=state)
        self.assertIsNone(current_generation(self.root, owner_uid=self.uid,
                                             root_gid=self.gid, state_root=state))

    def test_pointer_clear_refuses_to_remove_a_changed_generation(self):
        first = self.publish()
        second = self.publish(tuple(GenerationFile(item.path, item.content + b"next\n",
                                                   item.mode, item.gid) for item in self.files))
        switch_generation(self.root, first, expected_current=None,
                          owner_uid=self.uid, root_gid=self.gid)
        with self.assertRaisesRegex(BrokerGenerationRejected, "changed before pointer clear"):
            clear_generation_pointer(self.root, expected_current=second,
                                     owner_uid=self.uid, root_gid=self.gid)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid), first)


if __name__ == "__main__":
    unittest.main()
