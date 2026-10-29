"""Executable pnpm .bin link materialization regressions."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_install import install_payload


class DependencyInstallBinLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.payload = self.root / "payload"
        self.release = self.root / "release"
        (self.payload / "web" / "node_modules" / ".bin").mkdir(parents=True)
        (self.payload / "root" / "node_modules" / "dotenv").mkdir(parents=True)
        (self.release / "apps" / "web").mkdir(parents=True)

    def tearDown(self):
        for current, directories, _files in os.walk(self.root, topdown=True, followlinks=False):
            os.chmod(current, 0o700)
            for name in directories:
                child = Path(current) / name
                if not child.is_symlink():
                    os.chmod(child, 0o700)
        self.temp.cleanup()

    def test_bin_wrapper_preserves_relative_import_args_environment_and_exit(self):
        package = self.payload / "web" / "node_modules" / "tsx"
        package.mkdir()
        cli = package / "cli.mjs"
        cli.write_text(
            "#!/usr/bin/env node\n"
            "import { marker } from './support.mjs';\n"
            "if (process.env.WORKER_SMOKE_MARKER !== 'preserved') process.exit(22);\n"
            "if (marker !== 'relative-import-ok') process.exit(23);\n"
            "if (process.argv.includes('--fail')) process.exit(17);\n"
            "console.log(marker, process.argv[2]);\n", encoding="utf-8")
        cli.chmod(0o550)
        (package / "support.mjs").write_text(
            "export const marker = 'relative-import-ok';\n", encoding="utf-8")
        (package / "support.mjs").chmod(0o440)
        (self.payload / "web" / "node_modules" / ".bin" / "tsx").symlink_to("../tsx/cli.mjs")
        (self.payload / "root" / "node_modules" / "dotenv" / "index.js").write_text(
            "export const config = () => ({});\n", encoding="utf-8")

        install_payload(self.payload, self.release, owner_uid=os.geteuid())
        link = self.release / "apps" / "web" / "node_modules" / ".bin" / "tsx"
        self.assertTrue(link.is_file())
        self.assertFalse(link.is_symlink())
        self.assertTrue(link.read_text().startswith("#!/bin/sh\nset -eu\n"))
        environment = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                       "WORKER_SMOKE_MARKER": "preserved"}
        result = subprocess.run((str(link), "--version"), cwd=self.release / "apps" / "web",
                                env=environment, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, check=True, timeout=10)
        self.assertEqual(result.stdout.strip(), "relative-import-ok --version")
        failed = subprocess.run((str(link), "--fail"), cwd=self.release / "apps" / "web",
                                env=environment, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, check=False, timeout=10)
        self.assertEqual(failed.returncode, 17)

    def test_executable_bin_link_cannot_escape_its_materialized_tree(self):
        binary = self.payload / "web" / "node_modules" / ".bin" / "tsx"
        cli = self.payload / "root" / "node_modules" / "worker-cli" / "cli.mjs"
        cli.parent.mkdir(parents=True)
        cli.write_text("#!/usr/bin/env node\nprocess.exit(0);\n", encoding="utf-8")
        cli.chmod(0o550)
        binary.symlink_to("../../../root/node_modules/worker-cli/cli.mjs")

        with self.assertRaisesRegex(BuilderRejected, "binary target escapes its installed root"):
            install_payload(self.payload, self.release, owner_uid=os.geteuid())
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())
        self.assertFalse((self.release / "node_modules").exists())


if __name__ == "__main__":
    unittest.main()
