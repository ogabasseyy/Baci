#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

if [[ "${TESTFLIGHT_ONLY:-false}" == "true" ]]; then
  echo 'This run uploaded a TestFlight build only. App Store submission was intentionally skipped.' >> "$GITHUB_STEP_SUMMARY"
elif [[ "${SUBMISSION_OUTCOME:-}" == "failure" ]]; then
  echo 'The TestFlight upload completed, but App Store submission failed. Inspect the Fastlane submit logs.' >> "$GITHUB_STEP_SUMMARY"
elif [[ "${SUBMISSION_OUTCOME:-}" == "cancelled" ]]; then
  echo 'The TestFlight upload completed, but App Store submission was cancelled. Inspect the workflow run before retrying.' >> "$GITHUB_STEP_SUMMARY"
elif [[ "${SUBMISSION_RESULT:-}" == "submitted" ]]; then
  echo 'This run uploaded the iOS build and submitted it for App Store review.' >> "$GITHUB_STEP_SUMMARY"
elif [[ "${SUBMISSION_RESULT:-}" == "skipped" ]]; then
  echo 'This run uploaded a TestFlight build, but App Store submission was skipped because the App Store version slot is occupied.' >> "$GITHUB_STEP_SUMMARY"
else
  echo 'Fastlane completed without recording an App Store submission result; inspect the Fastlane logs.' >> "$GITHUB_STEP_SUMMARY"
fi
