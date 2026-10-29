"""Coarse, allowlisted metadata for policy-output marker diagnostics."""
from __future__ import annotations

import re
import errno

PREFIX_CATEGORIES = frozenset({"empty", "whitespace", "checkmark", "other"})
SUFFIX_CATEGORIES = frozenset({
    "empty", "fresh-positive", "fresh-zero-count", "cached", "parenthesized", "other",
})
LENGTH_BUCKETS = frozenset({"0", "1", "2", "3-8", "9+"})
POLICY_EVIDENCE_CLASSES = frozenset({"absent", "ambiguous", "malformed", "fresh", "cached", "stale"})
_ERRNO_CATEGORIES = {
    errno.ENOSPC: "filesystem-no-space",
    errno.EACCES: "filesystem-permission",
    errno.EPERM: "filesystem-permission",
    errno.ENOENT: "filesystem-missing",
    errno.EROFS: "filesystem-read-only",
    errno.EMFILE: "filesystem-descriptor-limit",
    errno.ENFILE: "filesystem-descriptor-limit",
    errno.ENOMEM: "filesystem-memory",
    errno.EEXIST: "filesystem-exists",
    errno.ELOOP: "filesystem-loop",
    errno.ENOTDIR: "filesystem-not-directory",
    errno.EIO: "filesystem-io",
}
_CHECKMARK_PREFIX = re.compile(r"\s*✓\s+")
_FRESH_SUFFIX = re.compile(
    r"\s*\(([0-9]{1,9}) entr(?:y|ies) in ((?:[0-9]+(?:\.[0-9]+)?(?:ms|s|m|h|d|y))"
    r"(?: [0-9]+(?:\.[0-9]+)?(?:ms|s|m|h|d|y))*)\)\s*"
)
_CACHED_SUFFIX = re.compile(r"\s*\(verified ([0-9]+)(ms|s|m|h|d|y) ago\)\s*")


def _length_bucket(value: str) -> str:
    length = len(value)
    if length <= 2:
        return str(length)
    return "3-8" if length <= 8 else "9+"


def safe_errno_category(error_number: int | None) -> str:
    """Map OS error numbers to a closed category without echoing path/text."""
    return _ERRNO_CATEGORIES.get(error_number, "filesystem-error")


def summarize_line_shape(prefix: str, suffix: str) -> dict[str, str]:
    """Classify marker surroundings without retaining any caller-provided text."""
    if prefix == "":
        prefix_category = "empty"
    elif prefix.isspace():
        prefix_category = "whitespace"
    elif _CHECKMARK_PREFIX.fullmatch(prefix):
        prefix_category = "checkmark"
    else:
        prefix_category = "other"

    fresh = _FRESH_SUFFIX.fullmatch(suffix)
    cached = _CACHED_SUFFIX.fullmatch(suffix)
    if suffix == "":
        suffix_category = "empty"
    elif fresh:
        suffix_category = "fresh-positive" if int(fresh.group(1)) > 0 else "fresh-zero-count"
    elif cached:
        suffix_category = "cached"
    elif suffix.strip().startswith("(") and suffix.strip().endswith(")"):
        suffix_category = "parenthesized"
    else:
        suffix_category = "other"
    return {
        "prefix_category": prefix_category,
        "prefix_length_bucket": _length_bucket(prefix),
        "suffix_category": suffix_category,
        "suffix_length_bucket": _length_bucket(suffix),
        "time_has_minutes": bool(fresh and re.search(r"(?:^| )\d+(?:\.\d+)?m(?: |$)", fresh.group(2))),
        "time_has_decimal": bool(fresh and "." in fresh.group(2)),
    }


def validate_evidence_summary(value: dict[str, object]) -> dict[str, object]:
    if (not isinstance(value, dict) or set(value) != {
            "classification", "phrase_lines", "recognized_lines", "line_shapes"}
            or value["classification"] not in POLICY_EVIDENCE_CLASSES
            or type(value["phrase_lines"]) is not int or not 0 <= value["phrase_lines"] <= 255
            or type(value["recognized_lines"]) is not int or not 0 <= value["recognized_lines"] <= 255
            or not isinstance(value["line_shapes"], list) or len(value["line_shapes"]) > 2):
        raise ValueError("policy evidence summary is invalid")
    for shape in value["line_shapes"]:
        if (not isinstance(shape, dict) or set(shape) != {
                "prefix_category", "prefix_length_bucket", "suffix_category", "suffix_length_bucket",
                "time_has_minutes", "time_has_decimal"}
                or shape["prefix_category"] not in PREFIX_CATEGORIES
                or shape["suffix_category"] not in SUFFIX_CATEGORIES
                or shape["prefix_length_bucket"] not in LENGTH_BUCKETS
                or shape["suffix_length_bucket"] not in LENGTH_BUCKETS
                or type(shape["time_has_minutes"]) is not bool
                or type(shape["time_has_decimal"]) is not bool):
            raise ValueError("policy evidence line shape is invalid")
    return value


def format_policy_line_shapes(evidence: dict[str, object]) -> str:
    """Render fixed categories and coarse length buckets only."""
    shapes = validate_evidence_summary(evidence)["line_shapes"]
    if not shapes:
        return ""
    return " line_shape=" + ";".join(
        f"{shape['prefix_category']}:{shape['prefix_length_bucket']}/"
        f"{shape['suffix_category']}:{shape['suffix_length_bucket']}"
        f":minutes={int(shape['time_has_minutes'])}:decimal={int(shape['time_has_decimal'])}"
        for shape in shapes
    )


__all__ = ["format_policy_line_shapes", "safe_errno_category", "summarize_line_shape",
           "validate_evidence_summary"]
