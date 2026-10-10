"""Build a private candidate bundle; never execute or install it."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from database_sql import render_database_sql
from runtime_artifacts import prepare_artifacts
from source_functions import (APP_SYSTEM, DEADLINE, GOAL_ID, HEX64, OLD_DEADLINE,
    RECEIPT_SYSTEM, SEALED, Refused, _md5, _require, _sealed_function_bodies,
    _sha, _source_files)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--artifacts", required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    output = Path(args.output)
    staging = output.with_name(output.name + ".preparing")
    staging_created = False
    try:
        _require(not output.exists() and not output.is_symlink()
                 and not staging.exists() and not staging.is_symlink(), "candidate_path_exists")
        inventory = json.loads(Path(args.baseline).read_text())
        from collector import collect
        safe = collect(inventory)
        staging.mkdir(mode=0o700, parents=True, exist_ok=False)
        staging_created = True
        sql = render_database_sql(safe, Path(args.repo_root))
        (staging / "database-renewal.sql").write_bytes(sql)
        os.chmod(staging / "database-renewal.sql", 0o600)
        artifact_manifest = prepare_artifacts(inventory, Path(args.artifacts), staging / "artifacts")
        manifest = {"status": "expiry_rebuild_prepared", "deadline": DEADLINE,
            "baselineObservedAt": safe["observedAt"], "databaseSqlSha256": _sha(sql),
            "artifacts": artifact_manifest,
            "observedConfiguredFirstCardEnabled": safe["runtime"].get("configuredFirstCardEnabled"),
            "observedRestrictedRoles": safe["database"].get("roles", []),
            "observedUnitStates": {row.get("name"): row.get("activeState") for row in safe["units"]},
            "changesApplied": False, "servicesRestarted": False, "newPaymentStarted": False}
        (staging / "candidate.json").write_text(json.dumps(manifest, sort_keys=True))
        os.chmod(staging / "candidate.json", 0o600)
        os.rename(staging, output)
        print(json.dumps({"status": manifest["status"], "deadline": DEADLINE,
            "databaseSqlSha256": manifest["databaseSqlSha256"],
            "artifactCount": len(artifact_manifest["artifacts"]),
            "changesApplied": False, "newPaymentStarted": False}))
    except Exception as error:
        if staging_created and staging.exists() and not staging.is_symlink():
            for path in sorted(staging.rglob("*"), reverse=True):
                if path.is_file() or path.is_symlink():
                    path.unlink()
                elif path.is_dir():
                    path.rmdir()
            staging.rmdir()
        reason = error.args[0] if isinstance(error, Refused) else "renewal_preparation_refused"
        print(json.dumps({"status": "refused", "reason": reason,
            "changesApplied": False, "newPaymentStarted": False}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
