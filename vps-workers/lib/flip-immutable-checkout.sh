#!/usr/bin/env bash
# Atomically switches the delegated worker checkout to a release's
# immutable per-SHA worktree. Called from promote_worker_release INSIDE
# the deploy lock (with the file promote), so wrappers, SHA marker, and
# executed code change together. Also directly executable for testing.
# Usage: flip-immutable-checkout.sh <remote-dir> <expected-sha>
set -euo pipefail

remote_dir="${1:?remote dir is required}"
expected_sha="${2:?expected SHA is required}"

repo_link="$(
  awk '
    # Last assignment wins, matching dotenv and the scoped-environment
    # reader: an operator override appended below a stale line must flip
    # the same checkout the poller executes.
    /^BACI_REPO_DIR=/ {
      value = $0
      sub(/^BACI_REPO_DIR=/, "", value)
      have_value = 1
    }
    END { if (have_value) print value }
  ' "$remote_dir/.env"
)"
repo_link="${repo_link%\"}"
repo_link="${repo_link#\"}"
repo_link="${repo_link%\'}"
repo_link="${repo_link#\'}"
case "$repo_link" in
  /*) ;;
  *)
    echo "BACI_REPO_DIR must be an absolute path." >&2
    exit 1
    ;;
esac
checkout_base="$(dirname "$repo_link")"
immutable_dir="$checkout_base/app-$expected_sha"
if [ ! -d "$immutable_dir" ]; then
  echo "Immutable checkout $immutable_dir is missing; rerun prepare." >&2
  exit 1
fi
if [ "$(git -C "$immutable_dir" rev-parse --verify HEAD 2>/dev/null)" != "$expected_sha" ]; then
  echo "Immutable checkout $immutable_dir does not match $expected_sha; refusing to flip." >&2
  exit 1
fi
previous_target=""
if [ -L "$repo_link" ]; then
  previous_target="$(readlink "$repo_link")"
else
  # One-time migration: the legacy in-place checkout can never become a
  # symlink in place (moving it would break every worktree gitdir
  # pointer, which stores absolute paths), so the release symlink takes
  # a sibling name and the live .env is re-pointed once. The legacy
  # directory stays frozen as the object source for future worktrees —
  # never pull it again. Nothing reads the new symlink path until the
  # .env rewrite below lands, so each step fails safe; the shared
  # flip+verify after this branch then converges identically.
  # Portable rewrite (no sed -i): consumers match strict
  # `^BACI_REPO_DIR=`, so delete every spelling and append one
  # canonical line. mktemp is 0600, the safe direction for a secrets
  # file if the live .env was more permissive. The temp file lives
  # beside its destination so the final mv is an atomic same-device
  # rename: a /tmp temp on another filesystem would silently degrade
  # to copy+unlink, exposing a half-written .env to concurrent
  # readers.
  repo_link="$checkout_base/app-live"
  ln -sfn "$immutable_dir" "$repo_link"
  tmp_env="$(mktemp "$remote_dir/.env.XXXXXX")" || exit 1
  grep -v -E '^[[:space:]]*(export[[:space:]]+)?BACI_REPO_DIR=' "$remote_dir/.env" > "$tmp_env" || true
  printf 'BACI_REPO_DIR=%s\n' "$repo_link" >> "$tmp_env"
  mv "$tmp_env" "$remote_dir/.env"
fi
ln -sfn "$immutable_dir" "$repo_link"
if [ "$(readlink "$repo_link")" != "$immutable_dir" ]; then
  echo "Release symlink flip failed; live checkout is unchanged." >&2
  exit 1
fi
# Retire checkouts older than the previous release: the current and
# previous dirs stay (a poll may still be executing the previous
# revision), and the age guard covers rapid redeploys. A candidate must
# be named EXACTLY app-<40-hex-sha> (never a loose app-* match: an
# operator directory like app-backup is silently skipped) AND be a
# registered worktree of the object source. Exact-SHA names that are
# not registered (failed-provision residue) warn and stay for the
# operator to inspect and remove by hand.
registered_worktrees="$(git -C "$immutable_dir" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0, 10)}' || true)"
for old_checkout in "$checkout_base"/app-*; do
  [ -L "$old_checkout" ] && continue
  [ -d "$old_checkout" ] || continue
  old_base="$(basename "$old_checkout")"
  old_suffix="${old_base#app-}"
  case "$old_suffix" in
    ????????????????????????????????????????)
      case "$old_suffix" in
        *[!0-9a-f]*) continue ;;
      esac
      ;;
    *) continue ;;
  esac
  [ "$old_checkout" != "$immutable_dir" ] || continue
  [ "$old_checkout" != "$previous_target" ] || continue
  if ! printf '%s\n' "$registered_worktrees" | grep -F -x -q "$old_checkout"; then
    echo "Skipping unregistered checkout during GC (inspect and remove by hand): $old_checkout" >&2
    continue
  fi
  if [ -n "$(find "$old_checkout" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    git -C "$immutable_dir" worktree remove --force "$old_checkout"
  fi
done
