#!/usr/bin/env python3
"""Update the Muse CLI and SARIF auditor pins from Meta's public stable channel."""

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CHANNEL_URL = "https://api.meta.ai/muse-code/channels/muse-stable"
MANIFEST_HOST = "lookaside.facebook.com"
VERSION_RE = re.compile(r"\A[0-9]+\.[0-9]+\.[0-9]+-R[0-9]+\.[0-9]+\Z")
SHA_RE = re.compile(r"\A[0-9a-f]{64}\Z")


def fetch_json(url, expected_host):
    request = urllib.request.Request(url, headers={"User-Agent": "Baci-Muse-Pin-Updater"})
    with urllib.request.urlopen(request, timeout=30) as response:
        final_url = urllib.parse.urlparse(response.geturl())
        if final_url.scheme != "https" or final_url.hostname != expected_host:
            raise ValueError("metadata request redirected to an untrusted host")
        return json.load(response)


def resolve_pins(channel):
    version = channel.get("version")
    manifest_url = channel.get("manifest_url")
    if channel.get("state") != "public" or not isinstance(version, str) \
            or not VERSION_RE.fullmatch(version):
        raise ValueError("stable channel did not return a public version in the expected format")
    parsed = urllib.parse.urlparse(manifest_url or "")
    if parsed.scheme != "https" or parsed.hostname != MANIFEST_HOST:
        raise ValueError("stable channel returned an untrusted manifest URL")
    manifest = fetch_json(manifest_url, MANIFEST_HOST)
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


def update_files(root, pins):
    install = root / ".github/scripts/muse-review/install.sh"
    install_text = install.read_text()
    install_text = replace_once(install_text, r'^MUSE_VERSION="[^"]+"$',
                                'MUSE_VERSION="' + pins["version"] + '"', "installer version")
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
    install.write_text(install_text)
    anchors.write_text(anchor_text)


def main():
    root = Path(__file__).resolve().parents[2]
    pins = resolve_pins(fetch_json(CHANNEL_URL, "api.meta.ai"))
    update_files(root, pins)
    output = Path(__import__("os").environ["GITHUB_OUTPUT"])
    with output.open("a") as stream:
        stream.write("version=" + pins["version"] + "\n")
    print("Resolved public Muse stable pin " + pins["version"])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print("Muse pin update failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
