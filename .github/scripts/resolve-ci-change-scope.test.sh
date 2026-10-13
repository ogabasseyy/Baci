#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

run_case() {
  local event_name="$1"
  local expected="$2"
  shift 2
  : > "$output_file"
  env GITHUB_OUTPUT="$output_file" EVENT_NAME="$event_name" "$@" bash "$script_dir/resolve-ci-change-scope.sh"
  [[ "$(cat "$output_file")" == "$expected" ]]
}

all_true=$'mobile_admin=true\nmobile_storefront=true\nweb=true\nquiz_db=true\ncwv_runner=true\ndeploy_scripts=true'
forced_web=$'mobile_admin=false\nmobile_storefront=false\nweb=true\nquiz_db=false\ncwv_runner=false\ndeploy_scripts=false'
filtered=$'mobile_admin=true\nmobile_storefront=false\nweb=false\nquiz_db=true\ncwv_runner=false\ndeploy_scripts=true'
run_case merge_group "$all_true"
run_case workflow_dispatch "$forced_web" FORCE_QUALITY_GATES=true
run_case pull_request "$filtered" FILTER_MOBILE_ADMIN=true FILTER_MOBILE_STOREFRONT=false FILTER_WEB=false FILTER_QUIZ_DB=true FILTER_CWV_RUNNER=false FILTER_DEPLOY_SCRIPTS=true

printf 'CI change-scope tests passed.\n'
