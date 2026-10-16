"""Select and verify Semgrep coverage without interpreting filenames as lines."""

import json
import os
import pathlib
import shutil
import subprocess
import sys

EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".sql", ".yml", ".yaml"}
PREFIXES = (
    "apps/web/src/app/api/", "apps/web/src/lib/", "apps/web/src/schemas/",
    "apps/mobile-admin/app/", "apps/mobile-admin/hooks/", "apps/mobile-admin/lib/",
    "apps/mobile-storefront/app/", "apps/mobile-storefront/hooks/",
    "apps/mobile-storefront/lib/", "apps/mobile-storefront/services/",
    "apps/mobile-storefront/stores/", "packages/shared/", "supabase/migrations/",
    ".github/workflows/",
)
SELF_PATH = ".github/scripts/semgrep-sarif-analysis-diagnostics.py"


def git_paths(arguments):
    workspace = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
    return subprocess.check_output([
        "git", "-c", f"safe.directory={workspace}", *arguments
    ]).split(b"\0")


def write_targets(paths):
    selected = [path for path in paths if path]
    pathlib.Path("semgrep.requested-targets").write_bytes(
        b"\0".join(selected) + (b"\0" if selected else b"")
    )


def is_source_path(path):
    name = os.fsdecode(path)
    return name == SELF_PATH or pathlib.PurePosixPath(name).suffix in EXTENSIONS


def collect_pr_targets(base_ref):
    paths = git_paths(["diff", "--name-only", "-z", "--diff-filter=d",
                       f"origin/{base_ref}...HEAD", "--"])
    write_targets(path for path in paths if path and
                  is_source_path(path) and
                  (os.fsdecode(path) in ("next.config.ts", SELF_PATH) or
                   os.fsdecode(path).startswith(PREFIXES)))


def collect_push_targets(targets):
    paths = git_paths(["ls-files", "-z", "--", *targets])
    write_targets(path for path in paths if path and
                  is_source_path(path))


def validate():
    if os.environ.get("EMPTY_PR_SCOPE") == "true":
        sys.exit(0)
    status_path = pathlib.Path("semgrep.analysis-status.json")
    status = {"status": "incomplete", "reason": "missing-or-invalid-report"}
    status_path.write_text(json.dumps(status))
    sarif = pathlib.Path("semgrep.sarif")
    if sarif.is_file():
        shutil.copyfile(sarif, "semgrep.raw.sarif")
    try:
        report = json.loads(pathlib.Path("semgrep.raw.json").read_text())
        if not isinstance(report, dict):
            raise ValueError("invalid report object")
        errors = report.get("errors")
        paths = report.get("paths")
        if not isinstance(errors, list) or not isinstance(paths, dict):
            raise ValueError("missing analysis diagnostics")
        scanned = paths.get("scanned")
        if not isinstance(scanned, list) or not scanned:
            raise ValueError("no scanned paths")
        if not all(isinstance(path, str) for path in scanned):
            raise ValueError("invalid scanned paths")
        skipped = paths.get("skipped", [])
        if not isinstance(skipped, list) or skipped:
            raise ValueError("reported skipped targets")
        if os.environ.get("SCAN_EVENT_NAME") in ("pull_request", "push"):
            manifest = pathlib.Path("semgrep.requested-targets").read_bytes()
            if not manifest.endswith(b"\0") or b"\0\0" in manifest:
                raise ValueError("invalid requested targets")
            expected = {os.fsdecode(path) for path in manifest.split(b"\0") if path}
            if not expected:
                raise ValueError("empty requested targets")
            missing = expected.difference(scanned)
            if missing:
                status.update(reason="requested-targets-not-scanned", missing_count=len(missing))
                status_path.write_text(json.dumps(status))
                raise ValueError("requested targets were not scanned")
        if errors:
            status.update(reason="analysis-errors", error_count=len(errors))
            status_path.write_text(json.dumps(status))
            print(f"::error::Semgrep reported {len(errors)} analysis errors; inspect the raw diagnostics artifact.")
            sys.exit(1)
        if not sarif.is_file() or not sarif.stat().st_size:
            raise ValueError("missing SARIF")
    except (OSError, ValueError, TypeError):
        print("::error::Semgrep did not produce complete readable analysis diagnostics.")
        sys.exit(1)
    status_path.write_text(json.dumps({"status": "complete", "scanned_count": len(scanned)}))
    print(f"Verified complete Semgrep analysis for {len(scanned)} paths.")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["validate"]:
            validate()
        elif len(sys.argv) == 3 and sys.argv[1] == "pr-targets":
            collect_pr_targets(sys.argv[2])
        elif len(sys.argv) > 2 and sys.argv[1] == "push-targets":
            collect_push_targets(sys.argv[2:])
        else:
            raise ValueError("invalid command")
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("::error::Unable to select or validate Semgrep targets.")
        sys.exit(1)
