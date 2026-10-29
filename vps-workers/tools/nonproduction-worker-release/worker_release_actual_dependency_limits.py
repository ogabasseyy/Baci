"""Payload bounds scoped to the disposable dependency experiment only."""
from __future__ import annotations

import worker_release_dependency_artifacts as artifacts
import worker_release_dependency_fs as dependency_fs
import worker_release_dependency_install as installer
from worker_release_actual_dependency_resources import MAX_TREE_BYTES

EXPERIMENT_PAYLOAD_BYTES = MAX_TREE_BYTES


def configure_experiment_payload_limits(smoke=None, *, materialization_limit: int | None = None) -> None:
    """Raise only this disposable experiment's payload limits under its scratch monitor."""
    artifacts.MAX_PAYLOAD_BYTES = EXPERIMENT_PAYLOAD_BYTES
    dependency_fs.MAX_PAYLOAD_BYTES = EXPERIMENT_PAYLOAD_BYTES
    if materialization_limit is not None:
        if (type(materialization_limit) is not int or materialization_limit < 0
                or materialization_limit > EXPERIMENT_PAYLOAD_BYTES):
            raise RuntimeError("experiment materialization headroom is invalid")
        installer.MAX_MATERIALIZED_BYTES = materialization_limit
    if smoke is not None:
        smoke.MAX_BYTES = EXPERIMENT_PAYLOAD_BYTES
