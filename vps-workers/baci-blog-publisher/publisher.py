"""Publish operator-approved Baci releases using a non-admin Auth identity."""
from __future__ import annotations

import argparse
import base64
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import stat
import urllib.error
import urllib.request
from uuid import UUID

API_ORIGIN = "https://aivqthbxdshhltbwipbr.supabase.co"
PUBLIC_ORIGIN = "https://usebaci.com"
CONFIG_PATH = Path.home() / ".config/baci/blog-publisher.json"
STATE_PATH = Path.home() / ".local/state/baci/blog-publisher.json"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_config(path: Path) -> dict:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise ValueError("Publisher credentials must be a private regular file")
    config = json.loads(path.read_text())
    key = config["api_key"]
    if not key.startswith("sb_publishable_"):
        parts = key.split(".")
        if len(parts) != 3:
            raise ValueError("Only a public API key is permitted")
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
        if claims.get("role") != "anon":
            raise ValueError("Only a public API key is permitted")
    UUID(config["user_id"])
    if not config.get("email") or not config.get("password"):
        raise ValueError("Publisher identity missing")
    return config


def api_request(path: str, key: str, token: str | None, body: dict | None):
    headers = {"apikey": key, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        API_ORIGIN + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=30) as response:
        return json.loads(response.read(2_000_000))


class HeadingParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_heading = False
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self.in_heading = True

    def handle_endtag(self, tag):
        if tag == "h1":
            self.in_heading = False

    def handle_data(self, data):
        if self.in_heading:
            self.text.append(data)


def verify_public_page(slug: str, title: str) -> str:
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        raise ValueError("Invalid release slug")
    url = f"{PUBLIC_ORIGIN}/blog/{slug}"
    with urllib.request.urlopen(url, timeout=30) as response:
        if response.status != 200:
            raise ValueError("Public page unavailable")
        parser = HeadingParser()
        parser.feed(response.read(4_000_000).decode("utf-8"))
    if " ".join("".join(parser.text).split()) != " ".join(title.split()):
        raise ValueError("Public page title does not match approved release")
    return url


def save_state(path: Path, state: dict):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(state, stream, indent=2)
    temporary.replace(path)


def run(config: dict, state_path: Path, *, dry_run: bool = False) -> list[dict]:
    auth = api_request("/auth/v1/token?grant_type=password", config["api_key"], None, {
        "email": config["email"], "password": config["password"],
    })
    token = auth["access_token"]
    user = api_request("/auth/v1/user", config["api_key"], token, None)
    if user["id"] != config["user_id"]:
        raise ValueError("Authenticated publisher identity mismatch")
    releases = api_request("/rest/v1/rpc/list_approved_baci_blog_releases", config["api_key"], token, {})
    if not isinstance(releases, list):
        raise ValueError("Invalid approved release list")
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    results = []
    for release in releases:
        release_id = str(UUID(release["release_id"]))
        if state.get(release_id, {}).get("verified"):
            continue
        if dry_run:
            results.append({"release_id": release_id, "title": release["title"]})
            continue
        published = api_request("/rest/v1/rpc/publish_approved_baci_blog_release", config["api_key"], token, {
            "p_release_id": release_id,
        })
        UUID(published["post_id"])
        state[release_id] = {**published, "verified": False}
        save_state(state_path, state)
        url = verify_public_page(published["slug"], release["title"])
        state[release_id]["verified"] = True
        save_state(state_path, state)
        results.append({"release_id": release_id, "post_id": published["post_id"], "url": url})
    return results


def main() -> int:
    arguments = argparse.ArgumentParser()
    arguments.add_argument("--dry-run", action="store_true")
    args = arguments.parse_args()
    try:
        results = run(read_config(CONFIG_PATH), STATE_PATH, dry_run=args.dry_run)
        print(json.dumps({"status": "dry_run" if args.dry_run else "completed", "releases": results}))
        return 0
    except urllib.error.HTTPError as error:
        print(json.dumps({"status": "failed", "http_status": error.code}))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "failed", "error_type": type(error).__name__}))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
