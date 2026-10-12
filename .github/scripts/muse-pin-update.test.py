#!/usr/bin/env python3
"""Offline validation for the Meta stable-channel pin updater."""

import importlib.util
import os
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

    def test_rejects_version_downgrade(self):
        with self.assertRaisesRegex(ValueError, "would downgrade the pinned"):
            updater.ensure_not_downgrade("1.4.6-R6000.1", "1.5.0-R6100.2")
        updater.ensure_not_downgrade("1.5.0-R6100.2", "1.5.0-R6100.2")
        updater.ensure_not_downgrade("1.5.1-R6100.2", "1.5.0-R6100.2")
        updater.ensure_not_downgrade("1.4.6-R6000.1", "1.5.0-R6100.2",
                                     allow_downgrade=True)

    def test_main_rejects_downgrade_before_writing(self):
        channel = {
            "state": "public", "version": "1.4.6-R6000.1",
            "manifest_url": "https://lookaside.facebook.com/muse/manifest.json",
        }
        manifest = {
            "version": "1.4.6-R6000.1", "checksum_algorithm": "sha256",
            "artifacts": {
                "x86_linux": {"checksum": "a" * 64},
                "aarch64_linux": {"checksum": "b" * 64},
            },
        }
        with mock.patch.object(updater, "fetch_json", side_effect=[channel, manifest]), \
                mock.patch.object(updater, "current_pinned_version",
                                  return_value="1.5.0-R6100.2"), \
                mock.patch.object(updater, "update_files") as update_files:
            with self.assertRaisesRegex(ValueError, "would downgrade the pinned"):
                updater.main()
            update_files.assert_not_called()

    def test_redirect_to_untrusted_host_is_refused_before_following(self):
        handler = updater.TrustedRedirectHandler("api.meta.ai")
        request = updater.urllib.request.Request("https://api.meta.ai/stable")
        with self.assertRaisesRegex(ValueError, "untrusted host"):
            handler.redirect_request(request, None, 302, "Found", {},
                                     "https://evil.example/stable")
        with self.assertRaisesRegex(ValueError, "untrusted host"):
            handler.redirect_request(request, None, 302, "Found", {},
                                     "http://api.meta.ai/stable")
        followed = handler.redirect_request(request, None, 302, "Found", {},
                                            "https://api.meta.ai/stable2")
        self.assertEqual(followed.full_url, "https://api.meta.ai/stable2")

    def test_rejects_duplicate_pin_assignments(self):
        with self.assertRaisesRegex(ValueError, "expected exactly one installer version pin"):
            updater.replace_once(
                'MUSE_VERSION="1.4.6-R6000.1"\nMUSE_VERSION="1.4.6-R6000.1"\n',
                r'^MUSE_VERSION="[^"]+"$',
                'MUSE_VERSION="1.5.0-R6100.2"',
                "installer version",
            )

    def test_main_supports_local_run_without_github_output(self):
        channel = {
            "state": "public", "version": "1.5.0-R6100.2",
            "manifest_url": "https://lookaside.facebook.com/muse/manifest.json",
        }
        manifest = {
            "version": "1.5.0-R6100.2", "checksum_algorithm": "sha256",
            "artifacts": {
                "x86_linux": {"checksum": "a" * 64},
                "aarch64_linux": {"checksum": "b" * 64},
            },
        }
        with mock.patch.object(updater, "fetch_json", side_effect=[channel, manifest]), \
                mock.patch.object(updater, "current_pinned_version",
                                  return_value="1.4.6-R6000.1"), \
                mock.patch.object(updater, "update_files"), \
                mock.patch.dict(os.environ, {}, clear=True):
            updater.main()

    def test_rejects_non_object_channel_or_manifest(self):
        with self.assertRaisesRegex(ValueError, "channel did not return a JSON object"):
            updater.resolve_pins(["not", "an", "object"])
        channel = {
            "state": "public", "version": "1.5.0-R6100.2",
            "manifest_url": "https://lookaside.facebook.com/muse/manifest.json",
        }
        with mock.patch.object(updater, "fetch_json", return_value=["not", "an", "object"]):
            with self.assertRaisesRegex(ValueError, "manifest did not return a JSON object"):
                updater.resolve_pins(channel)

    def test_updates_installer_and_auditor_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / ".github/scripts/muse-review/install.sh"
            anchors = root / ".github/scripts/semgrep_sarif_pins.py"
            installer.parent.mkdir(parents=True)
            installer.write_text(
                'MUSE_VERSION="1.4.6-R6000.1"\n'
                '# From the stable-channel manifest (retrieved 2020-01-01 over TLS):\n'
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
            updater.update_files(root, pins, retrieved="2026-01-02")
            installer_text = installer.read_text()
            anchors_text = anchors.read_text()
            self.assertIn("(retrieved 2026-01-02 over TLS)", installer_text)
            for expected in pins.values():
                self.assertIn(expected, installer_text)
                self.assertIn(expected, anchors_text)

    def test_unchanged_pin_is_a_noop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / ".github/scripts/muse-review/install.sh"
            anchors = root / ".github/scripts/semgrep_sarif_pins.py"
            installer.parent.mkdir(parents=True)
            installer.write_text(
                'MUSE_VERSION="1.5.0-R6100.2"\n'
                '# From the stable-channel manifest (retrieved 2020-01-01 over TLS):\n'
                'SHA_X86_LINUX="' + "c" * 64 + '"\n'
                'SHA_AARCH64_LINUX="' + "d" * 64 + '"\n'
            )
            anchors.parent.mkdir(parents=True, exist_ok=True)
            anchors.write_text(
                'MUSE_PINNED_VERSION = "1.5.0-R6100.2"\n'
                'MUSE_PINNED_SHA_X86 = (\n    "' + "c" * 64 + '"\n)\n'
                'MUSE_PINNED_SHA_AARCH64 = (\n    "' + "d" * 64 + '"\n)\n'
            )
            before = (installer.read_text(), anchors.read_text())
            pins = {"version": "1.5.0-R6100.2", "x86": "c" * 64, "aarch64": "d" * 64}
            updater.update_files(root, pins, retrieved="2026-01-02")
            self.assertEqual((installer.read_text(), anchors.read_text()), before)

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
