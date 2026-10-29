#!/usr/bin/env python3
"""Redacted, fixed-category diagnostics for pnpm preverification failures."""
from __future__ import annotations


def pnpm_failure_category(output: str) -> str:
    """Classify bounded tool output without returning any of its contents."""
    sample = output[:65_536].lower()
    if any(token in sample for token in ("econnreset", "econnrefused", "etimedout", "eai_again", "certificate has expired")):
        return "registry-network"
    if any(token in sample for token in ("http 401", "http 403", "http 404", "http 429", "http 5", "status code 401", "status code 403", "status code 429")):
        return "registry-response"
    if any(token in sample for token in ("trustpolicy", "minimumreleaseage", "supply-chain policy", "lockfile passes supply-chain")):
        return "lockfile-policy"
    if any(token in sample for token in ("unknown option", "unknown argument", "unsupported option", "invalid option")):
        return "unsupported-pnpm-option"
    if any(token in sample for token in ("enoent", "no such file or directory", "permission denied", "eacces")):
        return "filesystem-access"
    if any(token in sample for token in ("lockfile", "resolution", "could not resolve", "no matching version")):
        return "dependency-resolution"
    return "pnpm-exit"
