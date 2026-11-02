"""Execute a correction-only approval using the ordinary publisher identity."""
from __future__ import annotations

import argparse
import json
import urllib.error
from uuid import UUID

from publisher import CONFIG_PATH, api_request, read_config

CORRECTION_POSTS = {
    "df7c8d06-bfa2-4171-948e-548cb2f463a6",
    "8642fd90-400b-4264-a954-f588da5ccd59",
}


def apply_correction(config: dict, revision_id: str, expected_post_id: str) -> dict:
    revision_id = str(UUID(revision_id))
    expected_post_id = str(UUID(expected_post_id))
    if expected_post_id not in CORRECTION_POSTS:
        raise ValueError("Post is outside the approved two-post scope")
    auth = api_request("/auth/v1/token?grant_type=password", config["api_key"], None, {
        "email": config["email"], "password": config["password"],
    })
    token = auth["access_token"]
    user = api_request("/auth/v1/user", config["api_key"], token, None)
    if user.get("id") != config["user_id"]:
        raise ValueError("Publisher identity does not match")
    result = api_request("/rest/v1/rpc/apply_approved_baci_blog_correction",
                         config["api_key"], token, {"p_revision_id": revision_id})
    if (not isinstance(result, dict) or result.get("post_id") != expected_post_id
            or result.get("revision_id") != revision_id):
        raise ValueError("Correction receipt does not match approved target")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision_id")
    parser.add_argument("post_id")
    args = parser.parse_args()
    try:
        print(json.dumps(apply_correction(read_config(CONFIG_PATH), args.revision_id, args.post_id)))
    except urllib.error.HTTPError as error:
        # Do not print provider bodies, credentials or request headers.
        parser.exit(1, f"Correction RPC failed (HTTP {error.code}); verify the database receipt before retrying.\n")
    except (ValueError, KeyError, OSError):
        parser.exit(1, "Correction validation or connection failed; inspect the approved receipt before retrying.\n")


if __name__ == "__main__":
    main()
