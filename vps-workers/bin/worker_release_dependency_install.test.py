"""Executable pnpm .bin link materialization regressions."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_install import install_payload
import worker_release_dependency_install as install_module


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

    def test_pnpm_virtual_store_transitive_aliases_are_materialized_for_node_resolution(self):
        root_modules = self.payload / "root" / "node_modules"
        virtual = root_modules / ".pnpm"
        package_a = virtual / "pkg-a@1.0.0" / "node_modules" / "pkg-a"
        package_b = virtual / "pkg-b@1.0.0" / "node_modules" / "pkg-b"
        peer_one = virtual / "pkg-peer@1.0.0" / "node_modules" / "pkg-peer"
        peer_two = virtual / "pkg-peer@2.0.0" / "node_modules" / "pkg-peer"
        package_a.mkdir(parents=True)
        package_b.mkdir(parents=True)
        peer_one.mkdir(parents=True)
        peer_two.mkdir(parents=True)
        (package_a / "package.json").write_text(
            '{"name":"pkg-a","type":"module","dependencies":{"pkg-b":"1.0.0"},'
            '"optionalDependencies":{"pkg-c":"1.0.0"},'
            '"peerDependencies":{"pkg-b":"1.0.0","pkg-peer":"^1"},'
            '"peerDependenciesMeta":{"pkg-b":{"optional":true}}}\n',
            encoding="utf-8")
        (package_a / "index.js").write_text(
            "import { version } from 'pkg-peer'; import { nested } from 'pkg-b'; "
            "export const answer = version; export function cycle() { return nested(); }\n",
            encoding="utf-8")
        (package_b / "package.json").write_text(
            '{"name":"pkg-b","type":"module","exports":"./index.js",'
            '"dependencies":{"pkg-a":"1.0.0"}}\n',
            encoding="utf-8")
        (package_b / "index.js").write_text(
            "import { answer } from 'pkg-a'; export function nested() { return answer; }\n",
            encoding="utf-8")
        for peer, version in ((peer_one, "1.0.0"), (peer_two, "2.0.0")):
            (peer / "package.json").write_text(
                '{"name":"pkg-peer","type":"module","exports":"./index.js"}\n',
                encoding="utf-8")
            (peer / "index.js").write_text(
                f"export const version = '{version}';\n", encoding="utf-8")
        (package_a.parent / "pkg-b").symlink_to("../../pkg-b@1.0.0/node_modules/pkg-b")
        (package_b.parent / "pkg-a").symlink_to("../../pkg-a@1.0.0/node_modules/pkg-a")
        (package_a.parent / "pkg-peer").symlink_to(
            "../../pkg-peer@1.0.0/node_modules/pkg-peer")
        (root_modules / "pkg-a").symlink_to(".pnpm/pkg-a@1.0.0/node_modules/pkg-a")
        (root_modules / "pkg-peer").symlink_to(".pnpm/pkg-peer@2.0.0/node_modules/pkg-peer")

        install_payload(self.payload, self.release, owner_uid=os.geteuid())
        result = subprocess.run(
            ("node", "--input-type=module", "-e",
             "import { answer, cycle } from 'pkg-a'; "
             "if (answer !== '1.0.0' || cycle() !== '1.0.0') process.exit(2);"),
            cwd=self.release, env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, check=False, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.release / "node_modules" / "pkg-a" / "node_modules" / "pkg-b").is_symlink())

    def test_missing_required_pnpm_alias_fails_closed_and_rolls_back(self):
        root_modules = self.payload / "root" / "node_modules"
        package = root_modules / ".pnpm" / "pkg-missing-owner@1.0.0" / "node_modules" / "pkg-owner"
        package.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"pkg-owner","dependencies":{"pkg-required":"1.0.0"}}\n',
            encoding="utf-8")
        (root_modules / "pkg-owner").symlink_to(
            ".pnpm/pkg-missing-owner@1.0.0/node_modules/pkg-owner")
        with self.assertRaisesRegex(BuilderRejected, "required dependency alias is missing"):
            install_payload(self.payload, self.release, owner_uid=os.geteuid())
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())
        self.assertFalse((self.release / "node_modules").exists())

    def test_package_manifest_cannot_traverse_materialized_dependency_root(self):
        root_modules = self.payload / "root" / "node_modules"
        package = root_modules / ".pnpm" / "pkg-owner@1.0.0" / "node_modules" / "pkg-owner"
        package.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"pkg-owner","dependencies":{"../escape":"1.0.0"}}\n',
            encoding="utf-8")
        (root_modules / "pkg-owner").symlink_to(
            ".pnpm/pkg-owner@1.0.0/node_modules/pkg-owner")
        with self.assertRaisesRegex(BuilderRejected, "dependency name is invalid"):
            install_payload(self.payload, self.release, owner_uid=os.geteuid())
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())

    def test_versioned_peer_alias_falls_back_to_outer_pnpm_project_context(self):
        root_modules = self.payload / "root" / "node_modules"
        package = root_modules / ".pnpm" / "pkg-owner@1.0.0" / "node_modules" / "pkg-owner"
        peer = root_modules / ".pnpm" / "pkg-peer@2.0.0" / "node_modules" / "pkg-peer"
        package.mkdir(parents=True)
        peer.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"pkg-owner","type":"module","peerDependencies":{"pkg-peer":"^2"}}\n',
            encoding="utf-8")
        (package / "index.js").write_text(
            "import { version } from 'pkg-peer'; export const selected = version;\n",
            encoding="utf-8")
        (peer / "package.json").write_text(
            '{"name":"pkg-peer","type":"module","exports":"./index.js"}\n',
            encoding="utf-8")
        (peer / "index.js").write_text("export const version = '2.0.0';\n", encoding="utf-8")
        (root_modules / "pkg-owner").symlink_to(
            ".pnpm/pkg-owner@1.0.0/node_modules/pkg-owner")
        (root_modules / "pkg-peer").symlink_to(
            ".pnpm/pkg-peer@2.0.0/node_modules/pkg-peer")

        install_payload(self.payload, self.release, owner_uid=os.geteuid())
        result = subprocess.run(
            ("node", "--input-type=module", "-e",
             "import { selected } from 'pkg-owner'; if (selected !== '2.0.0') process.exit(2);"),
            cwd=self.release, env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, check=False, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_generated_dependency_directories_count_toward_entry_budget(self):
        root_modules = self.payload / "root" / "node_modules"
        package = root_modules / ".pnpm" / "pkg-owner@1.0.0" / "node_modules" / "pkg-owner"
        dependency = root_modules / ".pnpm" / "pkg-dep@1.0.0" / "node_modules" / "pkg-dep"
        package.mkdir(parents=True)
        dependency.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"pkg-owner","dependencies":{"@scope/pkg-dep":"1.0.0"}}\n',
            encoding="utf-8")
        (package.parent / "@scope").mkdir()
        (package.parent / "@scope" / "pkg-dep").symlink_to(
            "../../../pkg-dep@1.0.0/node_modules/pkg-dep")
        (dependency / "package.json").write_text('{"name":"@scope/pkg-dep"}\n', encoding="utf-8")
        (root_modules / "pkg-owner").symlink_to(
            ".pnpm/pkg-owner@1.0.0/node_modules/pkg-owner")
        with patch.object(install_module, "MAX_MATERIALIZED_ENTRIES", 5):
            with self.assertRaisesRegex(BuilderRejected, "too many entries"):
                install_payload(self.payload, self.release, owner_uid=os.geteuid())
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())
        self.assertFalse((self.release / "node_modules").exists())

    @unittest.skipUnless((Path(__file__).resolve().parents[1] / "node_modules" / ".pnpm").is_dir(),
                         "requires a locally installed real pnpm worker graph")
    def test_real_installed_pnpm_worker_packages_import_after_materialization(self):
        real_modules = Path(__file__).resolve().parents[1] / "node_modules"
        source_root = self.payload / "root" / "node_modules"
        shutil.rmtree(source_root)
        shutil.copytree(real_modules, source_root, symlinks=True)
        (self.release / "vps-workers").mkdir()
        install_payload(self.payload, self.release, owner_uid=os.geteuid())
        script = (
            "const [dotenv, supabase, expo] = await Promise.all(["
            "import('dotenv'), import('@supabase/supabase-js'), import('expo-server-sdk')]);"
            "if (typeof dotenv.config !== 'function' ||"
            " typeof supabase.createClient !== 'function' || typeof expo.Expo !== 'function') process.exit(2);"
            "const client = supabase.createClient('https://example.invalid', 'synthetic-smoke-key');"
            "const push = new expo.Expo({ accessToken: 'synthetic-smoke-token' });"
            "if (typeof client.from !== 'function' || typeof push.sendPushNotificationsAsync !== 'function') process.exit(3);"
        )
        result = subprocess.run(("node", "--input-type=module", "-e", script),
                                cwd=self.release / "vps-workers",
                                env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                                     "HOME": "/nonexistent", "NODE_ENV": "production"},
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, check=False, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(path.is_symlink() for path in (self.release / "node_modules").rglob("*")))


if __name__ == "__main__":
    unittest.main()
