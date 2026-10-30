#!/usr/bin/env python3
"""Install the isolated baci-release runner beside, never over, the legacy runner.

Dry-run is the default. --apply installs an official checksum-pinned Linux x64
runner into /home/baci-release/actions-runner, registers it with the unique
custom label baci-release and no default labels, and starts only its new service.
The legacy baci-deploy runner, its service, and its workspace are never edited.
"""

from __future__ import annotations

import argparse
import grp
import hashlib
import os
import platform
import pwd
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runner_migration_artifacts import (extract_runner_archive, request_github_runner_token,
    runner_artifact, validate_archive_members, verify_github_runner_registration)


REPOSITORY_URL = "https://github.com/ogabasseyy/Baci"
RUNNER_USER = "baci-release"
RUNNER_HOME = Path("/home/baci-release")
RUNNER_ROOT = RUNNER_HOME / "actions-runner"
RUNNER_NAME = "baci-release-01"
RUNNER_LABEL = "baci-release"
POLICY_PATH = Path(__file__).resolve().parents[2] / "infra/cwv-runner/policy.json"
ISOLATION_VERIFIER = Path(__file__).resolve().parents[1] / "lib/verify-worker-credential-isolation.sh"


def validate_release_account(*, uid: int, username: str, home: Path, groups: Sequence[str]) -> None:
    if username != RUNNER_USER or uid <= 0 or home != RUNNER_HOME:
        raise RuntimeError("dedicated runner account does not match baci-release identity contract")
    if set(groups) != {RUNNER_USER}:
        raise RuntimeError("baci-release must have only its dedicated primary group")


def validate_registration_is_isolated(config_args: Sequence[str]) -> None:
    args = list(config_args)
    if "--no-default-labels" not in args or "--labels" not in args:
        raise RuntimeError("runner registration must disable default labels and use the isolated label")
    label_index = args.index("--labels")
    if label_index + 1 >= len(args) or args[label_index + 1] != RUNNER_LABEL:
        raise RuntimeError("runner registration label is not uniquely baci-release")
    if "baci-deploy" in args or "--replace" in args:
        raise RuntimeError("runner migration must preserve the legacy runner and avoid label overlap")


def _run(command: Sequence[str], *, cwd: Path | None = None, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> str:
    try:
        result = runner(tuple(command), cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True, check=False,
                        env={"HOME": "/root", "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    except OSError as error:
        raise RuntimeError("runner migration command could not be started") from error
    if result.returncode != 0:
        raise RuntimeError("runner migration command failed; legacy runner remains untouched")
    return result.stdout or ""


def _safe_chown_tree(path: Path, uid: int, gid: int) -> None:
    for root, directories, files in os.walk(path, followlinks=False):
        for name in directories + files:
            candidate = Path(root) / name
            if candidate.is_symlink():
                continue
            os.chown(candidate, uid, gid, follow_symlinks=False)
    os.chown(path, uid, gid, follow_symlinks=False)


def _matching_service_units(service_dir: Path) -> list[Path]:
    return list(service_dir.glob(f"actions.runner.*.{RUNNER_NAME}.service"))


def _verify_service_unit(service_dir: Path) -> Path:
    matches = _matching_service_units(service_dir)
    if len(matches) != 1 or matches[0].is_symlink() or not matches[0].is_file():
        raise RuntimeError("new runner systemd unit could not be identified safely")
    content = matches[0].read_text(encoding="utf-8")
    if f"User={RUNNER_USER}" not in content or f"WorkingDirectory={RUNNER_ROOT}" not in content:
        raise RuntimeError("new runner service does not run from the isolated baci-release home")
    return matches[0]


def _verify_local_registration(account_uid: int) -> None:
    for name in (".runner", ".credentials"):
        path = RUNNER_ROOT / name
        try:
            info = path.lstat()
        except FileNotFoundError as error:
            raise RuntimeError("dedicated runner configuration files are incomplete") from error
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != account_uid or info.st_mode & 0o077:
            raise RuntimeError("dedicated runner configuration file ownership or mode is unsafe")


def apply_migration(*, archive_path: Path,
                    repo_root: Path, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
                    credential_verifier: Path = ISOLATION_VERIFIER,
                    service_dir: Path = Path("/etc/systemd/system"),
                    token_provider: Callable[[str, str], str] = request_github_runner_token,
                    registration_verifier: Callable[[str], None] = verify_github_runner_registration) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("runner migration --apply requires root")
    if platform.system() != "Linux" or platform.machine().lower() not in ("x86_64", "amd64"):
        raise RuntimeError("pinned runner artifact requires a Linux x86_64 host")
    try:
        account = pwd.getpwnam(RUNNER_USER)
    except KeyError as error:
        raise RuntimeError("baci-release account is not provisioned") from error
    groups = [grp.getgrgid(group_id).gr_name for group_id in os.getgrouplist(RUNNER_USER, account.pw_gid)]
    validate_release_account(uid=account.pw_uid, username=account.pw_name, home=Path(account.pw_dir), groups=groups)
    if account.pw_shell not in ("/usr/sbin/nologin", "/sbin/nologin"):
        raise RuntimeError("baci-release must remain a non-login system account")
    home_info = RUNNER_HOME.lstat()
    if not stat.S_ISDIR(home_info.st_mode) or stat.S_ISLNK(home_info.st_mode) or (home_info.st_uid, home_info.st_gid, stat.S_IMODE(home_info.st_mode)) != (account.pw_uid, account.pw_gid, 0o700):
        raise RuntimeError("baci-release home ownership or mode is not trusted")
    if RUNNER_ROOT.exists() or RUNNER_ROOT.is_symlink():
        raise RuntimeError("baci-release runner directory already exists; refusing overwrite")
    _, _, expected_digest = runner_artifact(repo_root / "infra/cwv-runner/policy.json")
    if not archive_path.is_file() or archive_path.is_symlink():
        raise RuntimeError("pinned runner archive must be a regular non-symlink file")
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if digest != expected_digest:
        raise RuntimeError("runner archive checksum does not match the reviewed repository pin")
    if not credential_verifier.is_file() or credential_verifier.is_symlink():
        raise RuntimeError("credential-isolation verifier is unavailable")
    if _matching_service_units(service_dir):
        raise RuntimeError("a service for this dedicated runner name already exists; refusing to alter it")

    admin_token = os.environ.pop("BACI_RUNNER_ADMIN_TOKEN", "")
    if not admin_token:
        raise RuntimeError("BACI_RUNNER_ADMIN_TOKEN is required to obtain short-lived GitHub runner tokens")
    # These one-hour tokens are held only in local variables and are never
    # written, emitted, or passed to any process other than the runner config.
    registration_token = token_provider("registration-token", admin_token)
    removal_token = token_provider("remove-token", admin_token)
    registration_verifier_token = admin_token
    admin_token = ""

    stage = RUNNER_HOME / f".actions-runner-staging-{os.getpid()}"
    if stage.exists() or stage.is_symlink():
        raise RuntimeError("dedicated runner staging path already exists; refusing overwrite")
    published_path = False
    config_attempted = False
    service_install_attempted = False
    try:
        extract_runner_archive(archive_path, stage)
        _safe_chown_tree(stage, account.pw_uid, account.pw_gid)
        os.rename(stage, RUNNER_ROOT)
        published_path = True
        config = RUNNER_ROOT / "config.sh"
        service_script = RUNNER_ROOT / "svc.sh"
        config_args = (str(config), "--unattended", "--url", REPOSITORY_URL, "--name", RUNNER_NAME,
                       "--labels", RUNNER_LABEL, "--no-default-labels", "--work", "_work",
                       "--disableupdate", "--token", registration_token)
        validate_registration_is_isolated(config_args)
        clean_release_env = ("/usr/bin/env", "-i", f"HOME={RUNNER_HOME}", "USER=baci-release", "LOGNAME=baci-release",
                             "PATH=/usr/local/bin:/usr/bin:/bin", "/usr/sbin/runuser", "-u", RUNNER_USER, "--", *config_args)
        config_attempted = True
        _run(clean_release_env, cwd=RUNNER_ROOT, runner=runner)
        _verify_local_registration(account.pw_uid)
        registration_token = ""
        service_install_attempted = True
        _run((str(service_script), "install", RUNNER_USER), cwd=RUNNER_ROOT, runner=runner)
        unit = _verify_service_unit(service_dir)
        _run(("/usr/bin/systemctl", "daemon-reload"), runner=runner)
        _run((str(credential_verifier),), runner=runner)
        registration_verifier(registration_verifier_token)
        registration_verifier_token = ""
        _run((str(service_script), "start"), cwd=RUNNER_ROOT, runner=runner)
        _run(("/usr/bin/systemctl", "is-active", "--quiet", unit.name), runner=runner)
        removal_token = ""
        registration_verifier_token = ""
    except Exception:
        if stage.exists() and not RUNNER_ROOT.exists():
            shutil.rmtree(stage, ignore_errors=True)
        if published_path:
            try:
                service_units = _matching_service_units(service_dir)
                if service_install_attempted and service_units:
                    _verify_service_unit(service_dir)
                    _run((str(RUNNER_ROOT / "svc.sh"), "stop"), cwd=RUNNER_ROOT, runner=runner)
                if config_attempted:
                    clean_release_remove = ("/usr/bin/env", "-i", f"HOME={RUNNER_HOME}", "USER=baci-release", "LOGNAME=baci-release",
                                            "PATH=/usr/local/bin:/usr/bin:/bin", "/usr/sbin/runuser", "-u", RUNNER_USER, "--",
                                            str(RUNNER_ROOT / "config.sh"), "remove", "--unattended", "--token", removal_token)
                    _run(clean_release_remove, cwd=RUNNER_ROOT, runner=runner)
                if service_install_attempted and service_units:
                    _run((str(RUNNER_ROOT / "svc.sh"), "uninstall", RUNNER_USER), cwd=RUNNER_ROOT, runner=runner)
                    _run(("/usr/bin/systemctl", "daemon-reload"), runner=runner)
            except Exception:
                # Keep the failed dedicated installation for operator reconciliation.
                raise RuntimeError("new runner setup failed; dedicated runner cleanup is incomplete; legacy runner remains untouched")
            shutil.rmtree(RUNNER_ROOT)
        raise


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="install/register and start the isolated runner; default is a no-change plan")
    parser.add_argument("--archive", type=Path, help="locally downloaded runner archive matching the repository SHA-256 pin")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    try:
        version, url, digest = runner_artifact(args.repo_root / "infra/cwv-runner/policy.json")
        print(f"Runner version: {version}")
        print(f"Pinned source: {url}")
        print(f"Pinned SHA-256: {digest}")
        print(f"Additive target: {RUNNER_ROOT}")
        print(f"Registration label: {RUNNER_LABEL} (default labels disabled)")
        print("Existing baci-deploy workflows remain routed to the legacy runner.")
        print("Any workflow changed to baci-release requires this runner to be active before that workflow change is enabled.")
        print("Legacy runner and service will not be changed.")
        if not args.apply:
            print("Dry run only. No account, runner, service, credential, or workflow was changed.")
            return 0
        if args.archive is None:
            raise RuntimeError("--archive is required with --apply")
        apply_migration(archive_path=args.archive, repo_root=args.repo_root.resolve())
        print("Dedicated baci-release runner registered and active; no workflow files were changed by this script.")
        return 0
    except (OSError, RuntimeError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f"baci-release runner migration failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
