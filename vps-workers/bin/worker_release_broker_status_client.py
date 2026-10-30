"""Bounded client for the broker's exact generation-status operation."""
from __future__ import annotations

import json
import socket
import stat
from pathlib import Path

from worker_release_broker_upgrade_errors import BrokerUpgradeRejected

BROKER_SOCKET = Path("/run/baci-worker-release/broker.sock")


def read_broker_generation_status(path: Path = BROKER_SOCKET, *, timeout: float = 2.0) -> str:
    if path != BROKER_SOCKET or not 0.05 <= timeout <= 5:
        raise BrokerUpgradeRejected("broker status endpoint is outside fixed policy")
    try:
        info, parent = path.lstat(), path.parent.lstat()
    except OSError as error:
        raise BrokerUpgradeRejected("broker status endpoint is unavailable") from error
    if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0
            or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0
            or stat.S_IMODE(parent.st_mode) != 0o710):
        raise BrokerUpgradeRejected("broker status endpoint metadata is unsafe")
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    payload = bytearray()
    try:
        client.settimeout(timeout)
        client.connect(str(path))
        client.sendall(b'{"operation":"broker-status"}\n')
        while not payload.endswith(b"\n"):
            chunk = client.recv(1024 - len(payload))
            if not chunk:
                break
            payload.extend(chunk)
            if len(payload) > 1024:
                raise BrokerUpgradeRejected("broker status response exceeds fixed limit")
    except OSError as error:
        raise BrokerUpgradeRejected("broker status query failed") from error
    finally:
        client.close()
    if not payload.endswith(b"\n"):
        raise BrokerUpgradeRejected("broker status response is incomplete")
    try:
        response = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BrokerUpgradeRejected("broker status response is invalid") from None
    digest = response.get("generationDigest") if isinstance(response, dict) else None
    if (not isinstance(response, dict)
            or set(response) != {"ok", "operation", "generationDigest"}
            or response.get("ok") is not True or response.get("operation") != "broker-status"
            or not isinstance(digest, str) or len(digest) != 64
            or any(char not in "0123456789abcdef" for char in digest)):
        raise BrokerUpgradeRejected("broker status response shape is invalid")
    return digest


__all__ = ["BROKER_SOCKET", "read_broker_generation_status"]
