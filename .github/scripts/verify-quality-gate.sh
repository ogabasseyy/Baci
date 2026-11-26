#!/usr/bin/env bash
set -euo pipefail

if [[ "$CHANGES_RESULT" != "success" ]]; then
  echo "changes job result: $CHANGES_RESULT"
  exit 1
fi

# A skipped DB gate is success only when no DB paths changed: if
# the detector flagged DB changes, replay and the disposable
# suites must have actually run (skipped would silently waive
# them). Config-smoke mode skips by design and stays exempt.
if [[ "$QUIZ_DB_CHANGED" == "true" && "$TEST_PLAN_MODE" != "config-smoke" ]]; then
  for db_result in "$DB_REPLAY_RESULT" "$DISPOSABLE_SQL_RESULT"; do
    if [[ "$db_result" == "skipped" ]]; then
      echo "DB paths changed but a DB gate was skipped: $db_result"
      exit 1
    fi
  done
fi

# Same rule for lint: a skip is only success when no lintable
# web or mobile paths changed.
if [[ ( "$WEB_CHANGED" == "true" || "$MOBILE_ADMIN_CHANGED" == "true" || "$MOBILE_STOREFRONT_CHANGED" == "true" ) && "$TEST_PLAN_MODE" != "config-smoke" && "$LINT_RESULT" == "skipped" ]]; then
  echo "Web or mobile paths changed but the lint gate was skipped"
  exit 1
fi

# Same rule for unit tests: quality-test holds the mobile tests too, so a skip
# is never success when web or mobile paths changed (it runs in config-smoke).
if [[ ( "$WEB_CHANGED" == "true" || "$MOBILE_ADMIN_CHANGED" == "true" || "$MOBILE_STOREFRONT_CHANGED" == "true" ) && "$TEST_RESULT" == "skipped" ]]; then
  echo "Web or mobile paths changed but the test gate was skipped"
  exit 1
fi

for result in "$CWV_RUNNER_CONTRACTS_RESULT" "$LINT_RESULT" "$TYPECHECK_RESULT" "${TYPECHECK_BUILD_RESULT:-skipped}" "$TEST_RESULT" "${REPO_SCANS_RESULT:-skipped}" "${MIGRATION_APPLIER_RESULT:-skipped}" "$WEB_TEST_RESULT" "$MISC_RESULT" "$DB_REPLAY_RESULT" "$DISPOSABLE_SQL_RESULT" "$MOBILE_QUALITY_RESULT" "$SILENT_REVERT_GUARD_RESULT" "$QUIZ_APPROVAL_RESULT"; do
  case "$result" in
    success|skipped)
      ;;
    *)
      echo "split quality job failed or was cancelled: $result"
      exit 1
      ;;
  esac
done

echo "Split quality gates passed."
