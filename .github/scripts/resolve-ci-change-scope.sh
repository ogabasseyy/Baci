#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [[ "${EVENT_NAME:-}" == "merge_group" ]]; then
  mobile_admin=true
  mobile_storefront=true
  web=true
  quiz_db=true
  cwv_runner=true
  deploy_scripts=true
else
  mobile_admin="${FILTER_MOBILE_ADMIN:-false}"
  mobile_storefront="${FILTER_MOBILE_STOREFRONT:-false}"
  web="${FILTER_WEB:-false}"
  quiz_db="${FILTER_QUIZ_DB:-false}"
  cwv_runner="${FILTER_CWV_RUNNER:-false}"
  deploy_scripts="${FILTER_DEPLOY_SCRIPTS:-false}"
  # Dispatched automation branches (e.g. Muse pin updates) change no web
  # paths but must still run mandated lint/typecheck/test gates on request.
  if [[ "${FORCE_QUALITY_GATES:-false}" == "true" ]]; then
    web=true
  fi
fi

{
  printf 'mobile_admin=%s\n' "$mobile_admin"
  printf 'mobile_storefront=%s\n' "$mobile_storefront"
  printf 'web=%s\n' "$web"
  printf 'quiz_db=%s\n' "$quiz_db"
  printf 'cwv_runner=%s\n' "$cwv_runner"
  printf 'deploy_scripts=%s\n' "$deploy_scripts"
} >> "$GITHUB_OUTPUT"
