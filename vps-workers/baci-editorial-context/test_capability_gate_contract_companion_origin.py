"""Extracted base scripts must never load their companion from the candidate."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = (
    ".github/scripts/capability_gate_contract_ci_checks.py",
    ".github/scripts/capability_gate_contract_workflow_checks.py",
    "vps-workers/baci-editorial-context/capability_gate_contract_private_fetch.py",
)


class CompanionOriginTests(unittest.TestCase):
    def test_import_uses_archived_companion_not_candidate(self):
        with tempfile.TemporaryDirectory(prefix="baci-gate-origin-") as tmp:
            trusted, candidate = Path(tmp) / "trusted", Path(tmp) / "candidate"
            candidate.mkdir()
            for rel in SCRIPTS:
                dest = trusted / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / rel, dest)
            (candidate / "capability_gate_contract_private_fetch.py").write_text(
                "raise RuntimeError('untrusted candidate imported')\n"
            )
            script = (
                "import sys; "
                f"sys.path.insert(0, {str(trusted / '.github/scripts')!r}); "
                "import capability_gate_contract_workflow_checks as guard; "
                "assert guard.PRIVATE_ENV"
            )
            result = subprocess.run(
                [sys.executable, "-I", "-c", script],
                cwd=candidate,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_tmp_copy_runs_from_repo_root(self):
        # The workflow runs a base-owned copy from /tmp: the checker must
        # derive the tree from the working directory, never its own path.
        repo = Path(__file__).resolve().parents[2]
        if not (repo / ".github/workflows/ci.yml").exists():
            self.skipTest("CI workflow unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            scripts = Path(tmp, ".github", "scripts")
            scripts.mkdir(parents=True)
            for name in ("capability_gate_contract_check.py", "capability_gate_contract_ci_checks.py", "capability_gate_contract_workflow_checks.py"):
                shutil.copy(repo / ".github/scripts" / name, scripts / name)
            companion = Path(tmp, "vps-workers/baci-editorial-context")
            companion.mkdir(parents=True)
            shutil.copy(repo / "vps-workers/baci-editorial-context/capability_gate_contract_private_fetch.py", companion)
            proc = subprocess.run(
                [sys.executable, str(scripts / "capability_gate_contract_check.py")],
                cwd=repo, capture_output=True, text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

if __name__ == "__main__":
    unittest.main()
