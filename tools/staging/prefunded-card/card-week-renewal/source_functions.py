"""Resolve independently sealed PostgreSQL function definitions."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
SEALED = json.loads((HERE / "sealed-source.json").read_text())
OLD_DEADLINE = SEALED["oldDeadline"]
DEADLINE = SEALED["newDeadline"]
APP_SYSTEM = "7685292944002592802"
RECEIPT_SYSTEM = "7686901100561231906"
GOAL_ID = "430314fd-cd8b-4579-98d4-e9f345713dd6"
HEX64 = re.compile(r"^[a-f0-9]{64}$")


class Refused(ValueError):
    pass


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise Refused(reason)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _md5(data: str) -> str:
    return hashlib.md5(data.encode("utf-8")).hexdigest()


def _source_files(repo_root: Path) -> dict[str, bytes]:
    source_root = repo_root / "tools/staging/prefunded-card"
    result = {}
    for name, expected_sha in SEALED["sourceFiles"].items():
        path = source_root / name
        _require(not path.is_symlink() and path.is_file(), "sealed_source_missing")
        data = path.read_bytes()
        _require(_sha(data) == expected_sha, "sealed_source_drift")
        result[name] = data
    return result


def _function_ddl(source: bytes, function_name: str) -> tuple[str, str]:
    text = source.decode("utf-8")
    pattern = re.compile(r"CREATE(?: OR REPLACE)? FUNCTION prefunded_card\."
        + re.escape(function_name) + r"\s*\([\s\S]*?\bAS\s+\$\$([\s\S]*?)\$\$;", re.IGNORECASE)
    matches = list(pattern.finditer(text))
    _require(len(matches) == 1, "sealed_function_source_ambiguous")
    match = matches[0]
    ddl = match.group(0).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
    return ddl, match.group(1)


def _sealed_function_bodies(repo_root: Path, source_files: dict[str, bytes]) -> dict[str, tuple[str, str, str]]:
    result = {}
    for signature, pinned in SEALED["functions"].items():
        source_ddl, source_body = _function_ddl(source_files[pinned["source"]], pinned["sourceName"])
        ddl, body = source_ddl, source_body
        if signature == "prefunded_card.checkout_reserve(jsonb,jsonb)":
            replacements = (
                ("prior.phase<>'completed'", "prior.phase NOT IN ('completed','retired_unconfirmed')"),
                ("AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied'",
                 "AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied'\n"
                 "    AND NOT prefunded_card.checkout_is_retired(operations.id)"),
            )
            for before, after in replacements:
                _require(body.count(before) == 1, "retirement_replacement_slot_drift")
                body = body.replace(before, after)
            _require(_md5(body) == pinned["oldBodyMd5"], "retirement_predecessor_drift")
        _require(_md5(body) == pinned["oldBodyMd5"], "sealed_function_definition_drift")
        if signature == "prefunded_card.checkout_intent_json(prefunded_card.checkout_intents)":
            before = "'expiresAt','2026-09-29T15:59:10Z'"
            after = "'expiresAt',to_char(intent.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"
            _require(body.count(before) == 1, "intent_expiry_source_drift")
            next_body = body.replace(before, after)
        else:
            _require(body.count(OLD_DEADLINE) > 0, "expiry_literal_missing")
            next_body = body.replace(OLD_DEADLINE, DEADLINE)
        _require(_md5(next_body) == pinned["newBodyMd5"], "sealed_candidate_definition_drift")
        body_match = re.search(r"\$\$([\s\S]*?)\$\$;", ddl)
        _require(body_match is not None, "sealed_function_ddl_invalid")
        candidate_ddl = ddl[:body_match.start(1)] + next_body + ddl[body_match.end(1):]
        result[signature] = (candidate_ddl, _md5(body), _md5(next_body))
    return result
