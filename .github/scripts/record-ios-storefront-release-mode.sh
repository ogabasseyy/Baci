#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

upload_completed="${TESTFLIGHT_UPLOAD_COMPLETED:-false}"
outcome="${SUBMISSION_OUTCOME:-}"
result="${SUBMISSION_RESULT:-}"

if [[ "${TESTFLIGHT_ONLY:-false}" == "true" && "$outcome" == "skipped" ]]; then
  message='This run uploaded a TestFlight build only. App Store submission was intentionally skipped.'
elif [[ "$outcome" == "failure" || "$outcome" == "cancelled" || "$outcome" == "skipped" ]]; then
  case "$outcome" in
    failure) message='App Store submission failed. Inspect the Fastlane submit logs.' ;;
    cancelled) message='App Store submission was cancelled. Inspect the workflow run before retrying.' ;;
    skipped) message='App Store submission did not start. Inspect the workflow run before retrying.' ;;
  esac
  if [[ "$upload_completed" == "true" ]]; then
    message="The TestFlight upload completed. $message"
  fi
elif [[ "$result" == "submitted" ]]; then
  message='This run submitted the iOS build for App Store review.'
  if [[ "$upload_completed" == "true" ]]; then
    message='This run uploaded the iOS build and submitted it for App Store review.'
  fi
elif [[ "$result" == "skipped" ]]; then
  message='This run skipped App Store submission because the App Store version slot is occupied.'
  if [[ "$upload_completed" == "true" ]]; then
    message='This run uploaded a TestFlight build, but App Store submission was skipped because the App Store version slot is occupied.'
  fi
else
  message='Fastlane completed without recording an App Store submission result. Inspect the Fastlane logs.'
fi

echo "$message" >> "$GITHUB_STEP_SUMMARY"
