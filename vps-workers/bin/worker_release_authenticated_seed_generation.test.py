import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BIN = Path(__file__).parent
TOOLS = BIN.parent / "tools" / "nonproduction-worker-release"
sys.path.insert(0, str(BIN))
sys.path.insert(0, str(TOOLS))
import worker_release_authenticated_seed_generation as stage_seed


class StageSeedGenerationTests(unittest.TestCase):
    def setUp(self):
        self.identity = SimpleNamespace(sha="a" * 40)
        self.source = Path("/fixed/source")
        self.pin = object()
        self.proof = object()

    def test_valid_existing_seed_skips_generation(self):
        result_info = SimpleNamespace(st_dev=1, st_ino=2)
        with patch.object(stage_seed, "_validate_result_resource", return_value=result_info), \
             patch.object(stage_seed, "_reuse_existing_seed", return_value=True), \
             patch.object(stage_seed, "_create_generation_root") as create:
            generated = stage_seed.generate_for_stage(
                {}, self.identity, expected_archive_sha256="b" * 64,
                source_path=self.source, source_pin=self.pin,
                transaction_id="c" * 32, result_resource=Path("/result"),
                resource_owner_uid=0, revalidate_identity=lambda: self.identity,
                release_lock_proof=self.proof,
            )
        self.assertFalse(generated)
        create.assert_not_called()

    def test_missing_seed_generates_with_authenticated_stage_inputs(self):
        runtime = importlib.import_module("worker_release_pinned_runtime")
        generation = importlib.import_module("dependency_seed_generation")
        result_info = SimpleNamespace(st_dev=1, st_ino=2)
        unit_root = Path("/result/seed-generation")
        response = {"archiveBase64": "trusted-envelope"}
        callback = lambda: self.identity
        with patch.object(stage_seed, "_validate_result_resource", return_value=result_info), \
             patch.object(stage_seed, "_reuse_existing_seed", return_value=False), \
             patch.object(stage_seed, "_create_generation_root",
                          return_value=(unit_root, (3, 4))), \
             patch.object(runtime, "verify_installed_runtime", return_value=(Path("/node"), Path("/pnpm"))), \
             patch.object(generation, "generate_authenticated_seed") as generate, \
             patch.object(stage_seed, "_remove_empty_generation_root") as remove:
            generated = stage_seed.generate_for_stage(
                response, self.identity, expected_archive_sha256="b" * 64,
                source_path=self.source, source_pin=self.pin,
                transaction_id="c" * 32, result_resource=Path("/result"),
                resource_owner_uid=0, revalidate_identity=callback,
                release_lock_proof=self.proof,
            )
        self.assertTrue(generated)
        args, kwargs = generate.call_args
        self.assertIs(args[0], response)
        self.assertIs(args[1], self.identity)
        self.assertEqual(kwargs["source_path"], self.source)
        self.assertIs(kwargs["source_pin"], self.pin)
        self.assertIs(kwargs["release_lock_proof"], self.proof)
        self.assertIs(kwargs["revalidate_identity"], callback)
        self.assertEqual(kwargs["node"], Path("/node"))
        self.assertEqual(kwargs["pnpm"], Path("/pnpm"))
        remove.assert_called_once_with(Path("/result"), (3, 4),
                                       expected_parent=(1, 2), resource_owner_uid=0)

    @unittest.skipUnless(os.geteuid() == 0, "recovery fixture requires root-owned stage resources")
    def test_recovery_uses_stage_fence_and_keeps_source_until_generation_recovery(self):
        recovery = importlib.import_module("dependency_seed_generation_recovery")
        with tempfile.TemporaryDirectory(prefix="stage-seed-recovery-", dir="/run") as tmp:
            root = Path(tmp)
            root.chmod(0o700)
            parent = root / f".{'a' * 40}.result.{'c' * 32}"
            parent.mkdir(mode=0o700)
            source = root / ".source"
            source.mkdir(mode=0o700)
            source.chmod(0o550)
            child = parent / stage_seed.RESOURCE_NAME
            child.mkdir(mode=0o700)
            child.chmod(0o700)
            os.chown(root, 0, 0)
            os.chown(parent, 0, 0)
            os.chown(source, 0, 0)
            os.chown(child, 0, 0)
            result_info, root_info, source_info = parent.stat(), root.stat(), source.stat()
            record = {
                "transaction_id": "c" * 32,
                "fence": {"sha": "a" * 40},
                "result_state": "created",
                "result_name": parent.name,
                "result_dev": result_info.st_dev,
                "result_ino": result_info.st_ino,
                "resource_root_dev": root_info.st_dev,
                "resource_root_ino": root_info.st_ino,
            }
            calls = []
            with patch.object(recovery, "recover_seed_generation",
                              side_effect=lambda *args, **kwargs: calls.append((args, kwargs))):
                self.assertTrue(stage_seed.recover_for_stage(
                    record, resource_root=root, resource_owner_uid=0,
                    source_path=source, source_identity=(source_info.st_dev, source_info.st_ino),
                ))
            self.assertEqual(len(calls), 1)
            self.assertTrue(source.exists())
            self.assertFalse(child.exists())
            self.assertTrue(parent.exists())


if __name__ == "__main__":
    unittest.main()
