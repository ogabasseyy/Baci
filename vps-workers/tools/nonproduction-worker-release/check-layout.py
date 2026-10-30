#!/usr/bin/env python3
"""Read-only validation of a synthetic worker identity layout."""
import argparse
import os
import stat
import sys

DIRS = ("releases", "shared", "locks", "logs", "runtime")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--release-uid", type=int)
    parser.add_argument("--worker-uid", type=int)
    args = parser.parse_args()
    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        parser.error("--root must be an existing directory")
    failures = []
    root_stat = os.stat(root, follow_symlinks=False)
    if stat.S_IMODE(root_stat.st_mode) != 0o750:
        failures.append(f"{root}: expected mode 0750, got {stat.S_IMODE(root_stat.st_mode):04o}")
    for name in DIRS:
        path = os.path.join(root, name)
        if not os.path.isdir(path) or os.path.islink(path):
            failures.append(f"{path}: expected real directory")
            continue
        info = os.stat(path, follow_symlinks=False)
        if stat.S_IMODE(info.st_mode) != 0o750:
            failures.append(f"{path}: expected mode 0750, got {stat.S_IMODE(info.st_mode):04o}")
        if args.worker_uid is not None and info.st_uid != args.worker_uid:
            failures.append(f"{path}: expected worker uid {args.worker_uid}, got {info.st_uid}")
    secret = os.path.join(root, "runtime", "worker.env")
    if os.path.lexists(secret):
        if os.path.islink(secret) or not os.path.isfile(secret):
            failures.append(f"{secret}: expected regular non-symlink secret file")
        else:
            info = os.stat(secret, follow_symlinks=False)
            if stat.S_IMODE(info.st_mode) != 0o600:
                failures.append(f"{secret}: expected mode 0600, got {stat.S_IMODE(info.st_mode):04o}")
            if args.worker_uid is not None and info.st_uid != args.worker_uid:
                failures.append(f"{secret}: expected worker uid {args.worker_uid}, got {info.st_uid}")
            if args.release_uid is not None and info.st_uid == args.release_uid:
                failures.append(f"{secret}: release identity must not own worker secret")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("layout checks passed; no files or host state changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
