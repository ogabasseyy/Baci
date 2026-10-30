#!/usr/bin/env python3
"""Unprivileged worker for the disconnected authenticated seed prototype.

This worker emits no success record until the pinned policy preverify routine
has executed its real pnpm subprocesses and validated the receipt it wrote.
The containing systemd unit supplies the network boundary and proxy socket.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import socket
import threading
import sys

TOOLS = Path(__file__).resolve().parent
BIN = TOOLS.parents[1] / "bin"
sys.path[:0] = [str(BIN), str(TOOLS)]

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_policy_cache import (
    RECEIPT_NAME, TRUSTED_REGISTRY, preverify, validate_receipt,
)
from worker_release_egress_bridge import EgressBridge

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 3128
EGRESS_SOCKET = "/run/baci-seed-egress.sock"


def proxy_environment(env: dict[str, str] | None) -> dict[str, str]:
    """Force pnpm/npm children through the one loopback CONNECT listener."""
    restricted = dict(env or {})
    proxy = f"http://{PROXY_HOST}:{PROXY_PORT}"
    restricted.update({
        "HTTP_PROXY": proxy, "http_proxy": proxy,
        "HTTPS_PROXY": proxy, "https_proxy": proxy,
        "npm_config_proxy": proxy,
        "npm_config_https_proxy": proxy,
        "NO_PROXY": "", "no_proxy": "",
        "npm_config_noproxy": "",
    })
    return restricted


def _broker_connector():
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(10)
    client.connect(EGRESS_SOCKET)
    return client


def _mapped_host_id(map_path: str, namespace_id: int) -> int:
    try:
        rows = Path(map_path).read_text(encoding="ascii").splitlines()
        mappings = [tuple(map(int, row.split())) for row in rows]
    except (OSError, ValueError) as error:
        raise BuilderRejected("seed verifier user namespace mapping is unavailable") from error
    matches = [host + namespace_id - inner for inner, host, count in mappings
               if inner <= namespace_id < inner + count]
    if len(matches) != 1:
        raise BuilderRejected("seed verifier user namespace mapping is ambiguous")
    return matches[0]


def _check_identity(expected_uid: int, expected_gid: int) -> None:
    if (_mapped_host_id("/proc/self/uid_map", os.geteuid()) != expected_uid
            or _mapped_host_id("/proc/self/gid_map", os.getegid()) != expected_gid
            or os.getgroups()):
        raise BuilderRejected("seed verifier identity is not isolated")


def run_worker(source: Path, cache: Path, store: Path, pnpm: str, node: str,
               expected_sha: str, expected_uid: int, expected_gid: int) -> None:
    """Run the actual online policy verifier through the fixed local bridge."""
    _check_identity(expected_uid, expected_gid)
    stopping = threading.Event()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((PROXY_HOST, PROXY_PORT))
    listener.listen(8)
    bridge = EgressBridge(broker_connector=_broker_connector)
    server = threading.Thread(target=bridge.serve, args=(listener, stopping),
                              kwargs={"max_connections": 4}, daemon=True)
    server.start()
    try:
        import worker_release_dependency_policy_cache as policy
        real_run = policy.run_pnpm_checked

        def run_via_bridge(command, *, cwd, env=None, timeout, stage):
            return real_run(command, cwd=cwd, env=proxy_environment(env),
                            timeout=timeout, stage=stage)

        policy.run_pnpm_checked = run_via_bridge
        try:
            preverify(source, store, cache, pnpm, node)
        finally:
            policy.run_pnpm_checked = real_run
        receipt = validate_receipt(
            source, cache, store / RECEIPT_NAME, owner_uid=os.geteuid(),
            expected_sha=expected_sha, cache_owner_uid=os.geteuid(),
        )
        if (receipt.get("sourceSha") != expected_sha
                or receipt.get("registryRouting") != {
                    "default": TRUSTED_REGISTRY, "scoped": "none"}):
            raise BuilderRejected("seed preverification receipt does not match exact source policy")
    finally:
        stopping.set()
        listener.close()
        server.join(timeout=3)
        if server.is_alive():
            raise BuilderRejected("seed egress bridge did not stop")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--store", required=True)
    parser.add_argument("--pnpm", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--host-uid", required=True, type=int)
    parser.add_argument("--host-gid", required=True, type=int)
    args = parser.parse_args()
    run_worker(Path(args.source), Path(args.cache), Path(args.store),
               args.pnpm, args.node, args.sha, args.host_uid, args.host_gid)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Do not leak package URLs, environment, or captured pnpm output.
        category = type(error).__name__
        print(f"seed preverification rejected: {category}", file=sys.stderr)
        raise SystemExit(1)
