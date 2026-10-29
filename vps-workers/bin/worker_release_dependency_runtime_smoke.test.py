from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("worker_release_dependency_artifacts.py")
SPEC = importlib.util.spec_from_file_location("worker_release_dependency_artifacts", SCRIPT)
assert SPEC and SPEC.loader
artifacts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(artifacts)


def _candidate(root: Path) -> Path:
    payload = root / "payload"
    tsx = payload / "web/node_modules/tsx/cli.mjs"
    (payload / "web/node_modules/.bin").mkdir(parents=True)
    tsx.parent.mkdir(parents=True)
    tsx.write_text("#!/usr/bin/env node\n", encoding="utf-8")
    tsx.chmod(0o755)
    (payload / "web/node_modules/.bin/tsx").symlink_to("../tsx/cli.mjs")
    (payload / "root/node_modules/dotenv").mkdir(parents=True)
    return payload


class WorkerDependencyRuntimeSmokeTests(unittest.TestCase):
    def test_fixed_smoke_imports_real_worker_sdk_exports_from_candidate_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = _candidate(Path(temporary))
            results = [type("Result", (), {"stdout": "tsx 4.22.4\n"})(),
                       type("Result", (), {"stdout": ""})()]
            with patch.object(artifacts.subprocess, "run", side_effect=results) as run:
                evidence = artifacts.verify_runtime_candidates(payload)

            self.assertEqual(evidence, {"web_tsx": "passed", "worker_dotenv": "passed"})
            self.assertEqual(run.call_count, 2)
            command = run.call_args_list[1].args[0]
            self.assertEqual(command[:3], ("/usr/bin/node", "--input-type=module", "-e"))
            for module_name in ("dotenv", "@supabase/supabase-js", "expo-server-sdk"):
                self.assertIn(f"import('{module_name}')", command[-1])
            self.assertIn("supabase.createClient", command[-1])
            self.assertIn("expo.Expo", command[-1])
            self.assertEqual(run.call_args_list[1].kwargs["cwd"], payload / "root")
            self.assertEqual(run.call_args_list[1].kwargs["env"], {
                "PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production"
            })

    def test_missing_real_sdk_import_fails_the_runtime_smoke(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = _candidate(Path(temporary))
            results = [type("Result", (), {"stdout": "tsx 4.22.4\n"})(),
                       subprocess.CalledProcessError(
                           1, ("/usr/bin/node", "--input-type=module", "-e"))]
            with patch.object(artifacts.subprocess, "run", side_effect=results):
                with self.assertRaisesRegex(artifacts.BuilderRejected, "runtime smoke check failed"):
                    artifacts.verify_runtime_candidates(payload)


if __name__ == "__main__":
    unittest.main()
