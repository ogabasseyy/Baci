#!/usr/bin/env bash
# Provisions the immutable per-SHA application checkout for a worker
# release. Called from prepare-worker-release.sh (VPS side) with the
# staging dir and the deploying SHA; prints the provisioned checkout
# path. Also directly executable for testing.
# Usage: provision-immutable-checkout.sh <staging-dir> <expected-sha>
#
# Cron resolves BACI_REPO_DIR once per invocation, so an in-place `git
# pull` would change what the already-installed schedule executes
# immediately — before prepare, the migrations, or the capability smoke
# complete. Instead each release gets an immutable per-SHA worktree that
# is never pulled after creation; promote flips the BACI_REPO_DIR
# symlink to it atomically under the deploy lock. Never pull the live
# path in place.
set -euo pipefail

staging_dir="${1:?staging dir is required}"
expected_sha="${2:?expected SHA is required}"
env_file="$staging_dir/.env"

repo_link="$(
  awk '
    /^BACI_REPO_DIR=/ {
      sub(/^BACI_REPO_DIR=/, "")
      print
      exit
    }
  ' "$env_file"
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
repo_dir="$checkout_base/app-$expected_sha"
if [ ! -d "$repo_dir" ]; then
  if ! git -C "$repo_link" fetch --quiet origin "$expected_sha" 2>/dev/null; then
    echo "Cannot fetch $expected_sha on the VPS; push the deploying commit first." >&2
    exit 1
  fi
  if ! git -C "$repo_link" worktree add --detach --quiet "$repo_dir" "$expected_sha" 2>/dev/null; then
    echo "Cannot create the immutable checkout at $repo_dir; remove it and rerun." >&2
    exit 1
  fi
fi

if ! actual_sha="$(git -C "$repo_dir" rev-parse --verify HEAD 2>/dev/null)"; then
  echo "Immutable checkout at $repo_dir is unusable; remove it with 'git worktree remove --force $repo_dir' and rerun." >&2
  exit 1
fi
if [ -n "$(git -C "$repo_dir" status --porcelain=v1 --untracked-files=all)" ]; then
  echo "Direct-worker checkout is dirty." >&2
  exit 1
fi
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "Direct-worker checkout does not match the deploying commit." >&2
  exit 1
fi

# The TS entrypoints cron executes must exist at this revision; the
# wrappers below come from the staged worker tree instead.
for script_path in \
  apps/web/src/scripts/process-gigl-tracking.ts \
  apps/web/src/scripts/process-petrock-reconciliation.ts \
  apps/web/src/scripts/process-quiz-finalization.ts
do
  if [ ! -f "$repo_dir/$script_path" ]; then
    echo "Direct-worker checkout is missing $script_path." >&2
    exit 1
  fi
done

for wrapper_path in \
  "$staging_dir/bin/process-gigl-tracking.sh" \
  "$staging_dir/bin/verify-gigl-tracking-worker-capability.sh" \
  "$staging_dir/bin/process-petrock-reconciliation.sh" \
  "$staging_dir/bin/process-quiz-finalization.sh"
do
  if [ ! -x "$wrapper_path" ]; then
    echo "Missing or non-executable direct-worker wrapper: $wrapper_path" >&2
    exit 1
  fi
done

if [ ! -x "$repo_dir/apps/web/node_modules/.bin/tsx" ] && [ ! -x "$repo_dir/node_modules/.bin/tsx" ]; then
  echo "Installing immutable checkout dependencies (shared pnpm store)."
  if ! (cd "$repo_dir" && CI=true pnpm install --frozen-lockfile); then
    echo "Direct-worker checkout dependency install failed." >&2
    exit 1
  fi
fi

tsx_bin="$repo_dir/apps/web/node_modules/.bin/tsx"
if [ ! -x "$tsx_bin" ]; then
  # Mirror run-web-script.sh: a workspace-root install also satisfies the
  # worker entrypoints, so validate the same fallback before failing.
  tsx_bin="$repo_dir/node_modules/.bin/tsx"
fi
if [ ! -x "$tsx_bin" ] || ! "$tsx_bin" --version >/dev/null; then
  echo "Direct-worker checkout is missing the reviewed web toolchain." >&2
  exit 1
fi

# Re-point the STAGING env copy (never promoted: `.env*` is excluded) at
# the provisioned checkout, so the capability smoke verifies the
# candidate revision. The live .env keeps pointing at the release
# symlink until promote flips it. Portable rewrite (no sed -i): the
# consumers match strict `^BACI_REPO_DIR=`, so delete every spelling
# and append one canonical line.
tmp_env="$(mktemp)" || exit 1
grep -v -E '^[[:space:]]*(export[[:space:]]+)?BACI_REPO_DIR=' "$env_file" > "$tmp_env" || true
printf 'BACI_REPO_DIR=%s\n' "$repo_dir" >> "$tmp_env"
mv "$tmp_env" "$env_file"

printf '%s\n' "$repo_dir"
