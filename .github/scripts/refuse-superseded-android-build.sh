#!/usr/bin/env bash
set -euo pipefail

# Called only for main pushes; tag and manually selected releases keep their
# existing behavior. Recheck after acquiring the shared VPS resource queue.
current_main_sha="$(git ls-remote origin refs/heads/main | cut -f1)"
if [[ ! "$current_main_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo '::error::Unable to determine current main HEAD before Android build'
  exit 1
fi
if [[ "${GITHUB_SHA:?GITHUB_SHA is required}" != "$current_main_sha" ]]; then
  echo '::error::Superseded main release: refusing expensive Android build; use the current main release.'
  exit 1
fi
