"""Stable launcher validates and imports an installed generation under -I."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


LAUNCHER = Path(__file__).with_name("worker_release_broker_launcher.py")


def _installed_fixture(root: Path, pointer_root: Path) -> str:
    root.mkdir(mode=0o755)
    generations = root / "generations"
    generations.mkdir(mode=0o755)
    pointer_root.mkdir(mode=0o711)
    modules = {
        "worker_release_broker.py": "# broker entrypoint\n",
        "worker_release_broker_generation.py": "def verify_generation(*args, **kwargs): return True\n",
        "worker_release_broker_upgrade.py": (
            "def recover_before_start(*args, **kwargs): return None\n"
        ),
        "worker_release_broker_upgrade_control.py": "class SystemdBrokerControl: pass\n",
    }
    entries = []
    for name, content in sorted(modules.items()):
        data = content.encode()
        entries.append({"path": name, "mode": 0o440, "gid": os.getgid(), "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest()})
    payload = json.dumps({"version": 1, "files": entries}, sort_keys=True,
                         separators=(",", ":")).encode()
    digest = hashlib.sha256(payload).hexdigest()
    generation = generations / digest
    generation.mkdir(mode=0o700)
    for name, content in modules.items():
        path = generation / name
        path.write_text(content)
        os.chmod(path, 0o440)
    manifest = {"version": 1, "digest": digest, "files": entries}
    (generation / "generation.json").write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
    )
    os.chmod(generation / "generation.json", 0o444)
    os.chmod(generation, 0o555)
    (pointer_root / "current").symlink_to(generation)
    return digest


class BrokerManifestVerificationTests(unittest.TestCase):
    def test_tampered_generation_module_is_rejected_without_executing_it(self):
        import worker_release_broker_launcher as launcher

        with tempfile.TemporaryDirectory(prefix="broker-manifest-") as raw:
            base = Path(raw)
            root, pointer = base / "helper", base / "state" / "pointer"
            pointer.parent.mkdir(mode=0o755)
            digest = _installed_fixture(root, pointer)
            generation = root / "generations" / digest
            fd = os.open(generation, os.O_RDONLY | os.O_DIRECTORY)
            try:
                manifest = (generation / "generation.json").read_bytes()
                launcher._verify_manifest_files(fd, manifest, digest,
                                                owner_uid=os.getuid(), root_gid=os.getgid())
                module = generation / "worker_release_broker_generation.py"
                marker = base / "must-not-execute"
                os.chmod(module, 0o640)
                module.write_text(f"open({str(marker)!r}, 'w').write('ran')\\n")
                os.chmod(module, 0o440)
                with self.assertRaisesRegex(RuntimeError, "differs from manifest"):
                    launcher._verify_manifest_files(fd, manifest, digest,
                                                    owner_uid=os.getuid(), root_gid=os.getgid())
                self.assertFalse(marker.exists())
            finally:
                os.close(fd)


@unittest.skipUnless(sys.platform.startswith("linux") and os.geteuid() == 0,
                     "requires root-owned Linux installed-layout metadata")
class BrokerLauncherTests(unittest.TestCase):
    def test_tampered_verifier_module_never_executes_during_launcher_preflight(self):
        with tempfile.TemporaryDirectory(prefix="broker-launcher-tamper-", dir="/run") as raw:
            base = Path(raw)
            os.chmod(base, 0o755)
            root, pointer = base / "helper", base / "state" / "pointer"
            pointer.parent.mkdir(mode=0o755)
            digest = _installed_fixture(root, pointer)
            generation = root / "generations" / digest
            module = generation / "worker_release_broker_generation.py"
            marker = base / "verifier-was-imported"
            os.chmod(module, 0o640)
            module.write_text(
                f"open({str(marker)!r}, 'w').write('executed')\n"
                "def verify_generation(*args, **kwargs): return True\n"
            )
            os.chmod(module, 0o440)
            code = (
                "import runpy; m=runpy.run_path(" + repr(str(LAUNCHER)) + "); "
                "m['command'](['--release-uid','1001','--worker-uid','1002',"
                "'--worker-gid','1003'], root=" + repr(str(root)) + ", pointer_root="
                + repr(str(pointer)) + ", transaction_root=" + repr(str(pointer.parent)) + ")"
            )
            result = subprocess.run([sys.executable, "-I", "-c", code],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists())

    def test_subprocess_isolated_mode_imports_only_the_pinned_generation(self):
        with tempfile.TemporaryDirectory(prefix="broker-launcher-", dir="/run") as raw:
            base = Path(raw)
            os.chmod(base, 0o755)
            root = base / "helper"
            pointer = base / "state" / "pointer"
            pointer.parent.mkdir(mode=0o755)
            digest = _installed_fixture(root, pointer)
            code = (
                "import json,runpy; n=runpy.run_path(" + repr(str(LAUNCHER)) + "); "
                "print(json.dumps(n['command'](['--release-uid','1001','--worker-uid',"
                "'1002','--worker-gid','1003'], root=" + repr(str(root)) + ", pointer_root="
                + repr(str(pointer)) + ", transaction_root=" + repr(str(pointer.parent))
                + "), sort_keys=True))"
            )
            result = subprocess.run([sys.executable, "-I", "-c", code], check=True,
                                    capture_output=True, text=True)
            executable, arguments, environment = json.loads(result.stdout)
            self.assertEqual(executable, "/usr/bin/python3")
            self.assertEqual(arguments[1], "-I")
            self.assertEqual(arguments[2], str(root / "generations" / digest / "worker_release_broker.py"))
            self.assertEqual(arguments[-2:], ["--generation-digest", digest])
            self.assertEqual(environment, {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})

    def test_launcher_rejects_invalid_identity_arguments_before_exec(self):
        with tempfile.TemporaryDirectory(prefix="broker-launcher-", dir="/run") as raw:
            base = Path(raw)
            os.chmod(base, 0o755)
            root = base / "helper"
            pointer = base / "state" / "pointer"
            pointer.parent.mkdir(mode=0o755)
            _installed_fixture(root, pointer)
            with self.assertRaises(RuntimeError):
                import worker_release_broker_launcher as launcher
                launcher.command(["--release-uid", "0", "--worker-uid", "1002",
                                  "--worker-gid", "1003"], root=root, pointer_root=pointer,
                                 transaction_root=pointer.parent)


if __name__ == "__main__":
    unittest.main()
