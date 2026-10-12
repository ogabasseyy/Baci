#!/usr/bin/env python3
"""Offline validation for the Meta stable-channel pin updater."""

import importlib.util
import tempfile
import unittest
from unittest import mock
from pathlib import Path

SCRIPT = Path(__file__).with_name("muse-pin-update.py")
SPEC = importlib.util.spec_from_file_location("muse_pin_update", SCRIPT)
assert SPEC and SPEC.loader
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)


class MusePinUpdateTests(unittest.TestCase):
    def test_resolves_only_matching_public_sha256_manifest(self):
        channel = {
            "state": "public",
            "version": "1.5.0-R6100.2",
            "manifest_url": "https://lookaside.facebook.com/muse/manifest.json",
        }
        manifest = {
            "version": "1.5.0-R6100.2",
            "checksum_algorithm": "sha256",
            "artifacts": {
                "x86_linux": {"checksum": "a" * 64},
                "aarch64_linux": {"checksum": "b" * 64},
            },
        }
        with mock.patch.object(updater, "fetch_json", return_value=manifest):
            self.assertEqual(updater.resolve_pins(channel), {
                "version": "1.5.0-R6100.2", "x86": "a" * 64, "aarch64": "b" * 64,
            })

    def test_rejects_manifest_host_outside_meta_lookaside(self):
        channel = {
            "state": "public", "version": "1.5.0-R6100.2",
            "manifest_url": "https://example.com/manifest.json",
        }
        with self.assertRaisesRegex(ValueError, "untrusted manifest URL"):
            updater.resolve_pins(channel)

    def test_rejects_duplicate_pin_assignments(self):
        with self.assertRaisesRegex(ValueError, "expected exactly one installer version pin"):
            updater.replace_once(
                'MUSE_VERSION="1.4.6-R6000.1"\nMUSE_VERSION="1.4.6-R6000.1"\n',
                r'^MUSE_VERSION="[^"]+"$',
                'MUSE_VERSION="1.5.0-R6100.2"',
                "installer version",
            )

    def test_updates_installer_and_auditor_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / ".github/scripts/muse-review/install.sh"
            anchors = root / ".github/scripts/semgrep_sarif_pins.py"
            installer.parent.mkdir(parents=True)
            installer.write_text(
                'MUSE_VERSION="1.4.6-R6000.1"\n'
                'SHA_X86_LINUX="' + "a" * 64 + '"\n'
                'SHA_AARCH64_LINUX="' + "b" * 64 + '"\n'
            )
            anchors.parent.mkdir(parents=True, exist_ok=True)
            anchors.write_text(
                'MUSE_PINNED_VERSION = "1.4.6-R6000.1"\n'
                'MUSE_PINNED_SHA_X86 = (\n    "' + "a" * 64 + '"\n)\n'
                'MUSE_PINNED_SHA_AARCH64 = (\n    "' + "b" * 64 + '"\n)\n'
            )
            pins = {"version": "1.5.0-R6100.2", "x86": "c" * 64, "aarch64": "d" * 64}
            updater.update_files(root, pins)
            installer_text = installer.read_text()
            anchors_text = anchors.read_text()
            for expected in pins.values():
                self.assertIn(expected, installer_text)
                self.assertIn(expected, anchors_text)

    def test_validates_both_files_before_writing_either(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / ".github/scripts/muse-review/install.sh"
            anchors = root / ".github/scripts/semgrep_sarif_pins.py"
            installer.parent.mkdir(parents=True)
            original_installer = (
                'MUSE_VERSION="1.4.6-R6000.1"\n'
                'SHA_X86_LINUX="' + "a" * 64 + '"\n'
                'SHA_AARCH64_LINUX="' + "b" * 64 + '"\n'
            )
            installer.write_text(original_installer)
            anchors.parent.mkdir(parents=True, exist_ok=True)
            anchors.write_text('MUSE_PINNED_VERSION = "old"\n')
            pins = {"version": "1.5.0-R6100.2", "x86": "c" * 64, "aarch64": "d" * 64}
            with self.assertRaisesRegex(ValueError, "auditor x86 checksum"):
                updater.update_files(root, pins)
            self.assertEqual(installer.read_text(), original_installer)


if __name__ == "__main__":
    unittest.main()
