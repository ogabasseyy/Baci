#!/usr/bin/env bash
# Atomically switches the delegated worker checkout to a release's
# immutable per-SHA worktree. Called from promote_worker_release INSIDE
# the deploy lock (with the file promote), so wrappers, SHA marker, and
# executed code change together. Also directly executable for testing.
# Usage: flip-immutable-checkout.sh <remote-dir> <expected-sha>
#    or: flip-immutable-checkout.sh --restore-pointer <remote-dir> <snapshot-dir>
set -euo pipefail

# Single dotenv reader, shared with the provisioner and the cron
# entrypoints: every BACI_REPO_DIR spelling the preflight accepts
# (export prefix, spaces, colon separator, quotes, comments,
# duplicates) must resolve identically here. Primary: the staged bin
# beside this script (promote executes the staged copy); fallback: the
# repo source for direct execution from a checkout.
flip_lib_dir="$(cd "$(dirname "$0")" && pwd)"
dotenv_reader="$flip_lib_dir/../bin/gigl-dotenv.sh"
if [ ! -f "$dotenv_reader" ]; then
  dotenv_reader="$flip_lib_dir/../../.github/scripts/gigl-dotenv.sh"
fi
if [ ! -f "$dotenv_reader" ]; then
  echo "flip-immutable-checkout: missing gigl-dotenv.sh beside the staged tree and the repo." >&2
  exit 1
fi
# shellcheck source=../../.github/scripts/gigl-dotenv.sh
. "$dotenv_reader"

# Lexically collapses /./ and /name/../ segments of an absolute path
# (prints the result). Pure string work, no filesystem access:
# readlink -f/realpath are GNU-only and this suite also runs on
# macOS. Intermediate SYMLINK components are not resolved — the GC
# exclusion below is a string comparison against the walked base, so
# canonical bases (production) or realpath'd fixtures carry that half.
_normalize_absolute_path() {
  _norm_input="$1/"
  _norm_stack=""
  while [ -n "$_norm_input" ]; do
    _norm_seg="${_norm_input%%/*}"
    _norm_input="${_norm_input#*/}"
    case "$_norm_seg" in
      "" | ".") ;;
      "..") _norm_stack="${_norm_stack%/*}" ;;
      *) _norm_stack="$_norm_stack/$_norm_seg" ;;
    esac
  done
  printf '%s\n' "${_norm_stack:-/}"
}

# Last assignment wins inside the shared reader, matching dotenv and
# the scoped-environment reader: an operator override appended below a
# stale line must flip the same checkout the poller executes.
#
# Pointer-restore mode: reverses the checkout pointer (.env + app-live
# symlink) from a promote snapshot. The flip can fail AFTER repointing
# (killed mid-flight, failed verification), so every flip-failure
# restore — not just the first-deploy rollback — must reverse the
# pointer, not only the tree. No-op when the flip never mutated the
# pointer; shared by promote's flip-failure handler and rollback.
if [ "${1:-}" = "--restore-pointer" ]; then
  restore_remote_dir="${2:?remote dir is required}"
  restore_backup_dir="${3:?snapshot dir is required}"
  # The link path comes from the CURRENT .env (the flip's canonical
  # line is the created symlink in the migration case, the untouched
  # original in the pre-existing-symlink case), read BEFORE the .env
  # restore below.
  restore_link="$(gigl_dotenv_value "$restore_remote_dir/.env" 'BACI_REPO_DIR' 2>/dev/null || true)"
  if [ -e "$restore_backup_dir/.env" ]; then
    cp "$restore_backup_dir/.env" "$restore_remote_dir/.env"
  fi
  if [ "$(cat "$restore_backup_dir/app-live-target" 2>/dev/null)" = "NOSYMLINK" ]; then
    # Migration ran: remove ONLY the created symlink (guarded -L —
    # never a real directory).
    if [ -L "$restore_link" ]; then rm -f "$restore_link"; fi
  elif [ -n "$restore_link" ] && [ -e "$restore_backup_dir/app-live-target" ]; then
    # Pre-existing symlink: re-point to its pre-flip target.
    ln -sfn "$(cat "$restore_backup_dir/app-live-target")" "$restore_link"
  fi
  exit 0
fi

remote_dir="${1:?remote dir is required}"
expected_sha="${2:?expected SHA is required}"
repo_link="$(gigl_dotenv_value "$remote_dir/.env" 'BACI_REPO_DIR')"
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
  case "$previous_target" in
    /*) ;;
    # A pre-existing checkout link may point at a relative target
    # (app-live -> app-<sha>); readlink returns it verbatim while the
    # GC loop below walks absolute paths, so resolve against the link
    # directory (then collapse dot segments) or the previous release
    # is not excluded and gets retired mid-flip.
    *) previous_target="$checkout_base/$previous_target" ;;
  esac
  previous_target="$(_normalize_absolute_path "$previous_target")"
else
  # One-time migration: the legacy in-place checkout can never become a
  # symlink in place (moving it would break every worktree gitdir
  # pointer, which stores absolute paths), so the release symlink takes
  # a sibling name and the live .env is re-pointed once. The legacy
  # directory stays frozen as the object source for future worktrees —
  # never pull it again. Nothing reads the new symlink path until the
  # .env rewrite below lands, so each step fails safe; the shared
  # flip+verify after this branch then converges identically.
  # Portable rewrite (no sed -i): delete every `=`-spelling and append
  # one canonical line last — surviving colon/export/space forms sit
  # above it and the shared reader is last-wins, so the canonical line
  # always governs. mktemp is 0600, the safe direction for a secrets
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
    # Best-effort: GC is disk hygiene, not flip correctness — a locked
    # or unremovable old worktree must not fail the flip (app-live is
    # already repointed, so the caller would restore the tree against
    # the new checkout: a mixed release over a cleanup hiccup). The
    # residue is retried on the next flip; warn loudly so deploy logs
    # surface a stuck removal before disk pressure bites.
    if ! git -C "$immutable_dir" worktree remove --force "$old_checkout"; then
      echo "WARNING: could not retire old checkout during GC (left for the next flip or manual removal): $old_checkout" >&2
    fi
  fi
done
