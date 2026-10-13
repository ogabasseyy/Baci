#!/usr/bin/env python3
"""Update the Muse CLI and SARIF auditor pins from Meta's public stable channel."""

import datetime
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CHANNEL_URL = "https://api.meta.ai/muse-code/channels/muse-stable"
MANIFEST_HOST = "lookaside.facebook.com"
VERSION_RE = re.compile(r"\A[0-9]+\.[0-9]+\.[0-9]+-R[0-9]+\.[0-9]+\Z")
SHA_RE = re.compile(r"\A[0-9a-f]{64}\Z")
RETRIEVAL_DATE_RE = re.compile(
    r"\(retrieved [0-9]{4}-[0-9]{2}-[0-9]{2} over TLS\)")


class TrustedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse a redirect before any request is issued to an untrusted host."""

    def __init__(self, expected_host):
        super().__init__()
        self.expected_host = expected_host

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != "https" or parsed.hostname != self.expected_host:
            raise ValueError("metadata request redirected to an untrusted host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_json(url, expected_host):
    request = urllib.request.Request(url, headers={"User-Agent": "Baci-Muse-Pin-Updater"})
    opener = urllib.request.build_opener(TrustedRedirectHandler(expected_host))
    with opener.open(request, timeout=30) as response:
        final_url = urllib.parse.urlparse(response.geturl())
        if final_url.scheme != "https" or final_url.hostname != expected_host:
            raise ValueError("metadata request redirected to an untrusted host")
        return json.load(response)


def parse_version(version):
    match = re.fullmatch(r"([0-9]+)\.([0-9]+)\.([0-9]+)-R([0-9]+)\.([0-9]+)", version or "")
    if not match:
        raise ValueError("version is not in the expected format: " + str(version))
    return tuple(int(part) for part in match.groups())


def ensure_not_downgrade(new_version, current_version, allow_downgrade=False):
    if current_version and not allow_downgrade \
            and parse_version(new_version) < parse_version(current_version):
        raise ValueError(
            "stable channel version " + new_version + " would downgrade the pinned "
            + current_version + "; pass --allow-downgrade to override")


def resolve_pins(channel):
    if not isinstance(channel, dict):
        raise ValueError("stable channel did not return a JSON object")
    version = channel.get("version")
    manifest_url = channel.get("manifest_url")
    if channel.get("state") != "public" or not isinstance(version, str) \
            or not VERSION_RE.fullmatch(version):
        raise ValueError("stable channel did not return a public version in the expected format")
    parsed = urllib.parse.urlparse(manifest_url or "")
    if parsed.scheme != "https" or parsed.hostname != MANIFEST_HOST:
        raise ValueError("stable channel returned an untrusted manifest URL")
    manifest = fetch_json(manifest_url, MANIFEST_HOST)
    if not isinstance(manifest, dict):
        raise ValueError("manifest did not return a JSON object")
    if manifest.get("version") != version or manifest.get("checksum_algorithm") != "sha256":
        raise ValueError("manifest version or checksum algorithm does not match channel metadata")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("manifest artifacts are missing")
    result = {"version": version}
    for key, name in (("x86", "x86_linux"), ("aarch64", "aarch64_linux")):
        artifact = artifacts.get(name)
        checksum = artifact.get("checksum") if isinstance(artifact, dict) else None
        if not isinstance(checksum, str) or not SHA_RE.fullmatch(checksum):
            raise ValueError("manifest has an invalid SHA256 for " + name)
        result[key] = checksum
    return result


def replace_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
    if count != 1:
        raise ValueError("expected exactly one " + label + " pin")
    return updated


def normalized_installer_hash(path):
    """Hash the installer while treating only its retrieval date as variable."""
    text = Path(path).read_text()
    normalized, count = RETRIEVAL_DATE_RE.subn(
        "(retrieved DATE over TLS)", text)
    if count != 1:
        raise ValueError("expected exactly one manifest retrieval date")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def update_files(root, pins, retrieved=None):
    if retrieved is None:
        retrieved = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    install = root / ".github/scripts/muse-review/install.sh"
    install_text = install.read_text()
    # Refresh the retrieval date only when the pin itself changes, so
    # re-running the updater on an unchanged pin stays a no-op. The
    # comparison must use the pre-edit text: after substitution the
    # version term would always match.
    pin_unchanged = (
        'MUSE_VERSION="' + pins["version"] + '"' in install_text
        and 'SHA_X86_LINUX="' + pins["x86"] + '"' in install_text
        and 'SHA_AARCH64_LINUX="' + pins["aarch64"] + '"' in install_text)
    install_text = replace_once(install_text, r'^MUSE_VERSION="[^"]+"$',
                                'MUSE_VERSION="' + pins["version"] + '"', "installer version")
    if not pin_unchanged:
        install_text, date_count = re.subn(
            r"\(retrieved [0-9]{4}-[0-9]{2}-[0-9]{2} over TLS\)",
            "(retrieved " + retrieved + " over TLS)", install_text)
        if date_count != 1:
            raise ValueError("expected exactly one manifest retrieval date")
    install_text = replace_once(install_text, r'^SHA_X86_LINUX="[^"]+"$',
                                'SHA_X86_LINUX="' + pins["x86"] + '"', "installer x86 checksum")
    install_text = replace_once(install_text, r'^SHA_AARCH64_LINUX="[^"]+"$',
                                'SHA_AARCH64_LINUX="' + pins["aarch64"] + '"', "installer ARM checksum")

    anchors = root / ".github/scripts/semgrep_sarif_pins.py"
    anchor_text = anchors.read_text()
    anchor_text = replace_once(anchor_text, r'^MUSE_PINNED_VERSION = "[^"]+"$',
                               'MUSE_PINNED_VERSION = "' + pins["version"] + '"', "auditor version")
    anchor_text = replace_once(anchor_text,
                               r'(?s)^MUSE_PINNED_SHA_X86 = \(\n.*?\n\)',
                               'MUSE_PINNED_SHA_X86 = (\n    "' + pins["x86"] + '"\n)',
                               "auditor x86 checksum")
    anchor_text = replace_once(anchor_text,
                               r'(?s)^MUSE_PINNED_SHA_AARCH64 = \(\n.*?\n\)',
                               'MUSE_PINNED_SHA_AARCH64 = (\n    "' + pins["aarch64"] + '"\n)',
                               "auditor ARM checksum")
    # Stage both files beside their targets first, then rename, so a
    # failure before the renames leaves the pair untouched instead of
    # desyncing the installer and auditor pins. If a rename fails after
    # an earlier one landed, restore the landed targets from their
    # original text so the pair never stays desynced.
    originals = {install: install.read_text(), anchors: anchors.read_text()}
    staged = []
    replaced = []
    try:
        for target, text in ((install, install_text), (anchors, anchor_text)):
            tmp = target.with_name(target.name + ".tmp")
            tmp.write_text(text)
            staged.append((tmp, target))
        for tmp, target in staged:
            os.replace(tmp, target)
            replaced.append(target)
    except OSError:
        for target in replaced:
            rollback = target.with_name(target.name + ".rollback")
            rollback.write_text(originals[target])
            os.replace(rollback, target)
        raise
    finally:
        for tmp, _ in staged:
            tmp.unlink(missing_ok=True)


def current_pinned_version(root):
    anchors = root / ".github/scripts/semgrep_sarif_pins.py"
    match = re.search(r'^MUSE_PINNED_VERSION = "([^"]+)"$',
                      anchors.read_text(), flags=re.MULTILINE)
    if not match:
        raise ValueError("could not read the current pinned version")
    installer = root / ".github/scripts/muse-review/install.sh"
    install_match = re.search(r'^MUSE_VERSION="([^"]+)"$',
                              installer.read_text(), flags=re.MULTILINE)
    if not install_match:
        raise ValueError("could not read the current installer version")
    if install_match.group(1) != match.group(1):
        raise ValueError("installer and auditor pins disagree: "
                         + install_match.group(1) + " vs " + match.group(1))
    return match.group(1)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--normalized-installer-sha":
        print(normalized_installer_hash(sys.argv[2]))
        return
    root = Path(__file__).resolve().parents[2]
    pins = resolve_pins(fetch_json(CHANNEL_URL, "api.meta.ai"))
    ensure_not_downgrade(pins["version"], current_pinned_version(root),
                         allow_downgrade="--allow-downgrade" in sys.argv)
    update_files(root, pins)
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with Path(output_path).open("a") as stream:
            stream.write("version=" + pins["version"] + "\n")
    print("Resolved public Muse stable pin " + pins["version"])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print("Muse pin update failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
