# Sourced by dependency-builder-systemd-test.sh; keep shared setup in one process.

python3 - "$source_root" "$release_root" "$sha" "$suffix" "$helper_root" <<'PY'
import importlib.util, os, subprocess, sys, time
from pathlib import Path
from types import SimpleNamespace
import worker_release_dependency_builder as dependency_builder
import worker_release_dependency_sandbox as dependency_sandbox
from worker_release_dependency_consumer import _verify_candidate
from worker_release_dependency_install import install_payload

source, release, sha = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
helper_root = Path(sys.argv[5])
diagnostic_module_path = helper_root / "dependency-builder-fixture-pnpm.py"
diagnostic_spec = importlib.util.spec_from_file_location("fixture_pnpm_diagnostic", diagnostic_module_path)
if diagnostic_spec is None or diagnostic_spec.loader is None:
    raise RuntimeError("fixture pnpm diagnostic helper is unavailable")
diagnostic_module = importlib.util.module_from_spec(diagnostic_spec)
diagnostic_spec.loader.exec_module(diagnostic_module)
from worker_release_dependency_builder import uuid
uuid.uuid4 = lambda: SimpleNamespace(hex=sys.argv[4])

def run_fixture_sandbox(command, scratch, unit, *, usage_root=None, owner_uid=None):
    # The production helper intentionally discards child output. This fixture
    # has only synthetic inputs and no secrets, so capture a small, redacted
    # diagnostic from its exact transient unit when it fails.
    # The checkout lives below /home/runner, which the test service correctly
    # cannot traverse with ProtectHome=true. Execute the same copied module
    # set from the root-owned, world-readable fixture directory instead.
    fixture_command = tuple(
        str(helper_root / "worker_release_dependency_builder.py")
        if argument == str(Path(dependency_builder.__file__))
        else argument
        for argument in command
    )
    worker_index = command.index("--sandbox-worker")
    source_snapshot = Path(command[worker_index + 1])
    seed_cache = source_snapshot.parent / "pnpm-cache-seed"
    seed_receipt = source_snapshot.parent / dependency_builder.RECEIPT_NAME
    if seed_receipt.parent == seed_cache or (seed_cache / dependency_builder.RECEIPT_NAME).exists():
        raise RuntimeError("policy receipt is not separated from the metadata cache seed")
    dependency_builder.validate_receipt(
        source_snapshot, seed_cache, seed_receipt,
        owner_uid=0, cache_owner_uid=0, expected_sha=sha,
    )
    if usage_root is None or Path(usage_root) != dependency_builder.BUILD_ROOT:
        raise RuntimeError("dependency builder did not forward the fixed build usage root")
    uid_argument = next((argument for argument in command if argument.startswith("--uid=")), None)
    expected_owner_uid = int(uid_argument.split("=", 1)[1]) if uid_argument else None
    if owner_uid is None or owner_uid == 0 or owner_uid != expected_owner_uid:
        raise RuntimeError("dependency builder did not forward the exact non-root sandbox owner")
    bounded_root = Path(usage_root)
    deadline = time.monotonic() + dependency_sandbox.MAX_BUILD_SECONDS + 15
    process = subprocess.Popen(
        fixture_command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={"PATH": "/usr/bin:/bin"},
    )
    try:
        while process.poll() is None:
            dependency_builder.directory_usage(
                bounded_root,
                max_entries=dependency_builder.MAX_BUILD_SCRATCH_ENTRIES,
                max_bytes=dependency_builder.MAX_BUILD_SCRATCH_BYTES,
            )
            if time.monotonic() >= deadline:
                subprocess.run(("/usr/bin/systemctl", "kill", "--kill-whom=all", "--signal=SIGKILL", unit),
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10, check=False)
                raise subprocess.TimeoutExpired(fixture_command, dependency_sandbox.MAX_BUILD_SECONDS + 15)
            time.sleep(0.25)
        process.wait()
    except BaseException:
        if process.poll() is None:
            subprocess.run(("/usr/bin/systemctl", "kill", "--kill-whom=all", "--signal=SIGKILL", unit),
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10, check=False)
            process.wait(timeout=15)
        raise
    if process.returncode == 0:
        return
    fixture_detail = diagnostic_module.read_scratch_diagnostic(
        scratch, build_root=dependency_builder.BUILD_ROOT, expected_sha=sha,
        owner_uid=expected_owner_uid,
    )
    fixture_stage = fixture_detail["fixture_stage"] if fixture_detail else "diagnostic-unavailable"
    fixture_network = fixture_detail["fixture_network"] if fixture_detail else "diagnostic-unavailable"
    fixture_injection = fixture_detail["fixture_injection"] if fixture_detail else "diagnostic-unavailable"
    error_code = fixture_detail["error_code"] if fixture_detail else "diagnostic-unavailable"
    fixture_package = fixture_detail["fixture_package"] if fixture_detail else "diagnostic-unavailable"
    package_coordinate_hash = (fixture_detail["package_coordinate_sha256"]
                               if fixture_detail else "diagnostic-unavailable")
    evidence_transition = (fixture_detail["trust_evidence_transition"]
                           if fixture_detail else "diagnostic-unavailable")
    headline_state = (fixture_detail["trust_headline_state"]
                      if fixture_detail else "diagnostic-unavailable")
    hint_state = (fixture_detail["trust_hint_state"]
                  if fixture_detail else "diagnostic-unavailable")
    print(f"dependency fixture transient unit failed exit={process.returncode} "
          f"fixture_stage={fixture_stage} fixture_network={fixture_network} "
          f"fixture_injection={fixture_injection} fixture_error={error_code} fixture_package={fixture_package} "
          f"package_coordinate_sha256={package_coordinate_hash} "
          f"trust_evidence_transition={evidence_transition} "
          f"trust_headline_state={headline_state} trust_hint_state={hint_state}",
          file=sys.stderr)
    raise subprocess.CalledProcessError(process.returncode, fixture_command)

dependency_builder.run_sandbox = run_fixture_sandbox
manifest, result_dir = dependency_builder.build(str(source), sha)
payload = _verify_candidate(manifest, result_dir, source, sha, os.geteuid())
install_payload(payload, release, owner_uid=os.geteuid())
# Match the production release access boundary: root owns immutable files,
# baci-worker is the read/execute group, and the builder stays outside it.
worker_gid = __import__("grp").getgrnam("baci-worker").gr_gid
for base in (release / "apps" / "web" / "node_modules", release / "node_modules"):
    for current, directories, files in os.walk(base, topdown=True, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            info = path.lstat()
            if os.path.isdir(path) and not path.is_symlink():
                if (info.st_uid != 0 or info.st_mode & 0o022
                        or (info.st_mode & 0o777) != 0o550):
                    raise RuntimeError("synthetic release directory mode or ownership drifted")
            elif os.path.isfile(path) and not path.is_symlink() and info.st_nlink == 1:
                if (info.st_uid != 0 or info.st_mode & 0o022
                        or (info.st_mode & 0o777) not in (0o440, 0o550)):
                    raise RuntimeError("synthetic release file mode or ownership drifted")
            else:
                raise RuntimeError("synthetic materialized release contains a non-regular entry")
            os.chown(path, 0, worker_gid, follow_symlinks=False)
        os.chown(current, 0, worker_gid, follow_symlinks=False)
os.chown(release / "apps", 0, worker_gid)
os.chown(release / "apps" / "web", 0, worker_gid)
print("dependency candidate materialized")
PY
