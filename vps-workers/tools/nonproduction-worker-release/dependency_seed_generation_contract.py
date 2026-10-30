"""Typed output contract for disconnected authenticated seed generation."""
from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy
import re
from collections.abc import Callable
import weakref

from worker_release_dependency_artifacts import BuilderRejected


class SeedGenerationRejected(BuilderRejected):
    """Authenticated seed generation failed closed."""


class GenerationCapability:
    """Opaque in-process capability issued only after seed verification."""

    __slots__ = ("__weakref__",)

    def __new__(cls, *_args, **_kwargs):
        raise TypeError("GenerationCapability cannot be directly constructed")


_CAPABILITIES: weakref.WeakKeyDictionary[GenerationCapability, tuple[
    dict[str, object], dict[str, object], Callable[[], None]
]] = weakref.WeakKeyDictionary()


def _issue_generation_capability(receipt: dict[str, object],
                                 attestation: dict[str, object],
                                 prepublish_guard: Callable[[], None]) -> GenerationCapability:
    if not callable(prepublish_guard):
        raise SeedGenerationRejected("trusted prepublication fence guard is required")
    capability = object.__new__(GenerationCapability)
    _CAPABILITIES[capability] = (deepcopy(receipt), deepcopy(attestation), prepublish_guard)
    return capability


def _generation_capability_values(value: object) -> tuple[
        dict[str, object], dict[str, object], Callable[[], None]]:
    if type(value) is not GenerationCapability or value not in _CAPABILITIES:
        raise SeedGenerationRejected("verified seed-generation capability is required")
    receipt, attestation, guard = _CAPABILITIES[value]
    if (not isinstance(receipt, dict) or not isinstance(attestation, dict)
            or not callable(guard)):
        raise SeedGenerationRejected("verified seed-generation capability is malformed")
    return receipt, attestation, guard


@dataclass(frozen=True)
class GenerationAttestation:
    """Root-created receipt binding source, authenticated fence, and drained unit."""

    schema: int
    fence: dict[str, object]
    archive_sha256: str
    source_tree_sha256: str
    unit: str
    unit_quiescence: str
    policy_receipt: dict[str, object]

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "GenerationAttestation":
        fence = value["fence"]
        policy_receipt = value["policyReceipt"]
        if not isinstance(fence, dict) or not isinstance(policy_receipt, dict):
            raise SeedGenerationRejected("stored generation attestation is malformed")
        return cls(
            schema=value["schema"], fence=fence,
            archive_sha256=value["archiveSha256"],
            source_tree_sha256=value["sourceTreeSha256"],
            unit=value["unit"], unit_quiescence=value["unitQuiescence"],
            policy_receipt=policy_receipt,
        )

    def as_dict(self) -> dict[str, object]:
        return {
            "schema": self.schema, "fence": self.fence,
            "archiveSha256": self.archive_sha256,
            "sourceTreeSha256": self.source_tree_sha256,
            "unit": self.unit, "unitQuiescence": self.unit_quiescence,
            "policyReceipt": self.policy_receipt,
        }


def validate_generation_attestation(value: object, *, source_sha: str,
                                    source_tree_sha256: str,
                                    policy_receipt: dict[str, object]) -> dict[str, object]:
    """Check the durable root-published attestation against seed contents."""
    expected_keys = {
        "schema", "fence", "archiveSha256", "sourceTreeSha256", "unit",
        "unitQuiescence", "policyReceipt",
    }
    if not isinstance(value, dict) or set(value) != expected_keys or value.get("schema") != 1:
        raise SeedGenerationRejected("seed generation attestation is malformed")
    fence = value.get("fence")
    fence_keys = {"repository", "workflow", "ref", "sha", "run_id", "run_attempt", "job_id", "status"}
    if (not isinstance(fence, dict) or set(fence) != fence_keys
            or fence.get("repository") != "ogabasseyy/Baci"
            or fence.get("workflow") != ".github/workflows/production-release.yml"
            or fence.get("ref") != "refs/heads/main" or fence.get("status") != "in_progress"
            or fence.get("sha") != source_sha
            or not isinstance(fence.get("run_id"), str)
            or not re.fullmatch(r"[1-9][0-9]{0,19}", fence["run_id"])
            or not isinstance(fence.get("job_id"), str)
            or not re.fullmatch(r"[1-9][0-9]{0,19}", fence["job_id"])
            or type(fence.get("run_attempt")) is not int or fence["run_attempt"] < 1):
        raise SeedGenerationRejected("seed generation fence does not match authenticated source")
    if (not isinstance(value.get("archiveSha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", value["archiveSha256"])
            or value.get("sourceTreeSha256") != source_tree_sha256
            or value.get("policyReceipt") != policy_receipt
            or value.get("unitQuiescence") != "systemd-collected-cgroup-and-uid-absence-proved"
            or not isinstance(value.get("unit"), str)
            or not re.fullmatch(
                rf"baci-worker-seed-{re.escape(source_sha[:12])}-[0-9a-f]{{32}}\.service",
                value["unit"],
            )):
        raise SeedGenerationRejected("seed generation attestation does not match verified content")
    return value


__all__ = ["GenerationAttestation", "SeedGenerationRejected", "validate_generation_attestation"]
