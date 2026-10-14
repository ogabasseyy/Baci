"""Classify the capability register for the scheduled freshness workflow.

Prints one word: fresh (structurally valid and inside the 14-day evidence
window), stale (valid but past the window), or broken (missing, malformed,
or invalid — the runtime would reject it for a reason other than age).
Always exits 0; the printed word is the signal, so the workflow can route
each case to its own accurately titled issue.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

STATUSES = ("fresh", "stale", "broken")
_ROW_STATUSES = {"code_evidenced", "production_verified", "unverified"}


def _moment(value):
    moment = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        raise ValueError("naive reviewed_at")
    return moment


def _evidence_state(evidence):
    """fresh, stale, or broken for production evidence (runtime mirror)."""
    if not isinstance(evidence, dict):
        return "broken"
    if any(not isinstance(evidence.get(key), str) or not evidence[key].strip() for key in ("workflow", "entitlement", "observation")):
        return "broken"
    deployed = evidence.get("deployed_revision", "")
    if not isinstance(deployed, str) or not re.fullmatch(r"[a-f0-9]{40}", deployed):
        return "broken"
    if not isinstance(evidence.get("verified_at"), str):
        return "broken"
    try:
        verified = dt.datetime.fromisoformat(evidence["verified_at"].replace("Z", "+00:00"))
        if verified.tzinfo is None:
            raise ValueError("naive verified_at")
    except (ValueError, TypeError, AttributeError):
        return "broken"
    age = dt.datetime.now(dt.timezone.utc) - verified
    if age < dt.timedelta():
        return "broken"  # Future-dated: the runtime rejects it as invalid.
    if age > dt.timedelta(days=14):
        return "stale"  # Needs re-observation, like the register window.
    return "fresh"


def _valid_row(row):
    if not isinstance(row, dict):
        return False
    if any(not isinstance(row.get(key), str) or not row[key].strip() for key in ("id", "title", "claim", "limitations")):
        return False
    # Mirror the runtime field limits: id 64, title 200, claim/limitations 1000.
    if len(row["id"]) > 64 or len(row["title"]) > 200 or len(row["claim"]) > 1000 or len(row["limitations"]) > 1000:
        return False
    if row.get("status") not in _ROW_STATUSES:
        return False
    refs = row.get("source_refs")
    if not isinstance(refs, list) or not refs or len(refs) > 20 or len(set(refs)) != len(refs):
        return False
    if any(not isinstance(ref, str) or not ref.strip() or len(ref) > 300 for ref in refs):
        return False
    # Mirror the runtime: production_verified rows must carry evidence, and
    # structurally invalid evidence is broken (staleness is handled by classify).
    if row["status"] == "production_verified" and _evidence_state(row.get("production_evidence")) == "broken":
        return False
    return True


def _reject_duplicate_keys(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate key")
        obj[key] = value
    return obj


def classify(register_path):
    """Return fresh, stale, or broken for the register at register_path."""
    try:
        # Same duplicate-key decoder as the runtime: a repeated key must not
        # silently keep the last value and classify fresh.
        data = json.loads(Path(register_path).read_text(), object_pairs_hook=_reject_duplicate_keys)
        if (
            not isinstance(data, dict)
            or type(data.get("schema_version")) is not int
            or data["schema_version"] != 1
            or not isinstance(data.get("source_revision"), str)
            or not re.fullmatch(r"[a-f0-9]{40}", data["source_revision"])
            or not isinstance(data.get("evidence_digest"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", data["evidence_digest"])
            or not isinstance(data.get("claims_digest"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", data["claims_digest"])
            or not isinstance(data.get("capabilities"), list)
            or not 1 <= len(data["capabilities"]) <= 50
            or not all(_valid_row(row) for row in data["capabilities"])
            or len({row["id"] for row in data["capabilities"]}) != len(data["capabilities"])
        ):
            return "broken"
        if any(
            row.get("status") == "production_verified"
            and _evidence_state(row.get("production_evidence")) == "stale"
            for row in data["capabilities"]
        ):
            return "stale"  # Evidence needs re-observation, like the window.
        age = dt.datetime.now(dt.timezone.utc) - _moment(data["reviewed_at"])
        if age < dt.timedelta():
            return "broken"  # Future-dated: the runtime rejects it as invalid.
        if age > dt.timedelta(days=14):
            return "stale"
        return "fresh"
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return "broken"


def main(argv=None):
    register_path = Path(argv[1]) if argv and len(argv) > 1 else Path(__file__).resolve().parents[2] / "docs/product/baci-capabilities.json"
    print(classify(register_path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
