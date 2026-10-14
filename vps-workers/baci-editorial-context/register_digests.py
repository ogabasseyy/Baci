"""Recompute the capability register's binding digests.

Usage:
  python3 register_digests.py [--register PATH] [--write]

Prints the evidence_digest and claims_digest for the register. With --write,
both fields are updated in place (formatting preserved). Run this after a
register re-review; the binding test and the writer runtime verify these
exact recipes, so never compute them by hand.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


def claims_digest_for(data):
    bound = {
        "capabilities": data["capabilities"],
        "reviewed_at": data["reviewed_at"],
        "source_revision": data["source_revision"],
        "review_scope": data.get("review_scope", ""),
        "evidence_digest": data.get("evidence_digest", ""),
    }
    return hashlib.sha256(json.dumps(bound, sort_keys=True).encode()).hexdigest()


def evidence_digest_for(repo, data):
    """Content digest over cited paths, their contents, and the claim text.

    Refs of `unverified` rows are existence-checked but not content-bound:
    those claims record that a capability is not established, so unrelated
    edits to the audited surfaces must not force a full re-review.
    """
    refs = sorted({ref for row in data["capabilities"] if row.get("status") != "unverified" for ref in row["source_refs"]})
    digest = hashlib.sha256()
    for ref in refs:
        digest.update(ref.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256((Path(repo) / ref).read_bytes()).hexdigest().encode())
        digest.update(b"\n")
    digest.update(json.dumps(data["capabilities"], sort_keys=True).encode())
    digest.update(str(data.get("reviewed_at", "")).encode())
    digest.update(str(data.get("source_revision", "")).encode())
    digest.update(str(data.get("review_scope", "")).encode())
    return digest.hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--register", default=None, help="register path (default: repo docs/product/baci-capabilities.json)")
    parser.add_argument("--repo", default=None, help="repo root the cited paths resolve against (default: derived from the register path)")
    parser.add_argument("--write", action="store_true", help="update the digest fields in place")
    args = parser.parse_args(argv)
    register_path = Path(args.register) if args.register else Path(__file__).resolve().parents[2] / "docs/product/baci-capabilities.json"
    repo = Path(args.repo) if args.repo else register_path.resolve().parents[2]
    data = json.loads(register_path.read_text())
    # Evidence first: the claims digest binds the evidence value, so it must
    # be computed after the fresh evidence digest is set.
    data["evidence_digest"] = evidence_digest_for(repo, data)
    data["claims_digest"] = claims_digest_for(data)
    print(f"evidence_digest: {data['evidence_digest']}")
    print(f"claims_digest: {data['claims_digest']}")
    if args.write:
        text = register_path.read_text()
        text, n_evidence = re.subn(r'"evidence_digest"\s*:\s*"[a-f0-9]{64}"', f'"evidence_digest": "{data["evidence_digest"]}"', text, count=1)
        text, n_claims = re.subn(r'"claims_digest"\s*:\s*"[a-f0-9]{64}"', f'"claims_digest": "{data["claims_digest"]}"', text, count=1)
        if n_evidence != 1 or n_claims != 1:
            print(f"error: could not update digest fields in {register_path} (evidence replaced: {n_evidence}, claims replaced: {n_claims}); fix the register JSON manually", file=sys.stderr)
            return 2
        register_path.write_text(text)
        print(f"updated {register_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
