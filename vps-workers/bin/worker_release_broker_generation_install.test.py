"""Regression: mutable broker code is generation-published, never in-place."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_broker_generation import GenerationFile, publish_generation, switch_generation, current_generation
from worker_release_broker_generation_install import split_install_records
from provision_worker_release_install import install_one


@dataclass(frozen=True)
class Record:
    destination: Path
    content: bytes
    mode: int
    group: str = "root"


@unittest.skipUnless(sys.platform.startswith("linux") and os.geteuid() == 0,
                     "requires root-owned Linux installation semantics")
class GenerationInstallTests(unittest.TestCase):
    def test_changed_broker_modules_are_generation_payload_and_stable_abi_refuses_replacement(self):
        with tempfile.TemporaryDirectory(prefix="broker-generation-install-", dir="/run") as raw:
            base = Path(raw)
            os.chmod(base, 0o755)
            helper = base / "helper"
            helper.mkdir(mode=0o755)
            pointer = base / "state" / "pointer"
            pointer.parent.mkdir(mode=0o755)
            pointer.mkdir(mode=0o711)

            initial = (
                Record(helper / "worker_release_broker_launcher.py", b"fixed launcher\n", 0o550),
                Record(helper / "worker_release_broker.py", b"broker version one\n", 0o550),
                Record(helper / "worker_release_broker_upgrade.py", b"upgrade one\n", 0o440),
            )
            stable, payload = split_install_records(initial, helper, lambda _name: 0)
            self.assertEqual({item.destination.name for item in stable},
                             {"worker_release_broker_launcher.py"})
            self.assertEqual({item.path for item in payload},
                             {"worker_release_broker.py", "worker_release_broker_upgrade.py"})

            launcher_path = stable[0].destination
            install_one(stable[0])
            first = publish_generation(helper, payload, owner_uid=0, root_gid=0)
            switch_generation(helper, first, expected_current=None, state_root=pointer,
                              state_mode=0o711, owner_uid=0, root_gid=0)

            changed = (
                Record(launcher_path, b"incompatible launcher\n", 0o550),
                Record(helper / "worker_release_broker.py", b"broker version two\n", 0o550),
                Record(helper / "worker_release_broker_upgrade.py", b"upgrade two\n", 0o440),
            )
            stable_update, next_payload = split_install_records(changed, helper, lambda _name: 0)
            with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
                install_one(stable_update[0])
            self.assertEqual(launcher_path.read_bytes(), b"fixed launcher\n")
            self.assertEqual(current_generation(helper, state_root=pointer, state_mode=0o711,
                                               owner_uid=0, root_gid=0), first)
            # The new mutable code remains only an unpublished candidate until
            # the broker upgrade controller writes its durable fence.
            self.assertNotEqual(next_payload, payload)


if __name__ == "__main__":
    unittest.main()
