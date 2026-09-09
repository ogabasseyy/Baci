#!/usr/bin/env bash
set -euo pipefail

operation="${1:-}"

case "$operation" in
  expose-posthog-cli)
    POSTHOG_CLI_BIN="$GITHUB_WORKSPACE/node_modules/.bin/posthog-cli"
    if [ ! -x "$POSTHOG_CLI_BIN" ]; then
      echo "::error::PostHog CLI is missing or not executable at $POSTHOG_CLI_BIN"
      exit 1
    fi
    dirname "$POSTHOG_CLI_BIN" >> "$GITHUB_PATH"
    ;;
  fix-hermes)
    HERMESC_SRC="$GITHUB_WORKSPACE/node_modules/hermes-compiler/hermesc"
    HERMESC_DST="$GITHUB_WORKSPACE/node_modules/react-native/sdks/hermesc"
    if [ -d "$HERMESC_SRC" ] && [ ! -e "$HERMESC_DST" ]; then
      ln -s "$HERMESC_SRC" "$HERMESC_DST"
      chmod +x "$HERMESC_DST/linux64-bin/hermesc" 2>/dev/null || true
    fi
    ;;
  resolve-version)
    if [ "$GH_EVENT_NAME" = "workflow_dispatch" ] && [ -n "$VERSION_CODE_INPUT" ]; then
      VERSION_CODE="$VERSION_CODE_INPUT"
    elif [ "$GH_REF_TYPE" = "tag" ]; then
      VERSION_CODE="${GH_REF_NAME#v}"
      VERSION_CODE="${VERSION_CODE%-storefront}"
    else
      VERSION_CODE=$(( GH_RUN_NUMBER + VERSION_CODE_BASE ))
    fi

    if ! [[ "$VERSION_CODE" =~ ^[1-9][0-9]*$ ]]; then
      echo "::error::Invalid version code '$VERSION_CODE'. Use a positive integer (>=1)."
      exit 1
    fi
    if [ "$VERSION_CODE" -gt 2100000000 ]; then
      echo "::error::Invalid version code '$VERSION_CODE'. Must be a positive integer <= 2100000000."
      exit 1
    fi

    echo "VERSION_CODE=$VERSION_CODE" >> "$GITHUB_ENV"
    echo "version_code=$VERSION_CODE" >> "$GITHUB_OUTPUT"
    ;;
  fix-splash)
    STYLES="android/app/src/main/res/values/styles.xml"
    if [ -f "$STYLES" ] && grep -q "splashscreen_logo" "$STYLES"; then
      sed -i '/@drawable\/splashscreen_logo/d' "$STYLES"
      echo "Removed splashscreen_logo reference from styles.xml"
    fi
    ;;
  decode-keystore)
    if [ -z "$KEYSTORE_BASE64" ]; then
      echo "::error::ANDROID_STOREFRONT_KEYSTORE_BASE64 secret is empty or not set"
      exit 1
    fi
    KEYSTORE_PATH="$(mktemp "${RUNNER_TEMP}/storefront-release-keystore.XXXXXX")"
    umask 077
    echo "$KEYSTORE_BASE64" | base64 -d > "$KEYSTORE_PATH"
    chmod 600 "$KEYSTORE_PATH"
    echo "ANDROID_STOREFRONT_KEYSTORE_FILE=$KEYSTORE_PATH" >> "$GITHUB_ENV"
    ;;
  build)
    # Production Play bundles only need the 64-bit ABI. Avoid compiling
    # emulator/x86 native variants on the persistent runner.
    GRADLE_ARGS="app:bundleRelease -PreactNativeArchitectures=arm64-v8a -x lint -x lintVitalAnalyzeRelease -x test --configure-on-demand --build-cache --max-workers=2 --no-daemon --stacktrace"
    # shellcheck disable=SC2086
    ./gradlew $GRADLE_ARGS
    ;;
  upload-guard)
    CURRENT_MAIN_SHA="$(git ls-remote origin refs/heads/main | cut -f1)"
    if [ -z "$CURRENT_MAIN_SHA" ]; then
      echo "::error::Unable to determine current main HEAD"
      exit 1
    fi

    if [ "${GITHUB_SHA}" = "$CURRENT_MAIN_SHA" ]; then
      echo "allow_upload=true" >> "$GITHUB_OUTPUT"
    else
      echo "allow_upload=false" >> "$GITHUB_OUTPUT"
      echo "Skipping Google Play upload because this run is not for the current main HEAD."
    fi
    ;;
  sync-update-gate)
    if [ -z "$VERCEL_TOKEN" ] || [ -z "$VERCEL_PROJECT_ID" ]; then
      echo "::warning::Vercel credentials missing — skipping update-gate sync"
      exit 0
    fi
    TEAM_QS=""
    if [ -n "$VERCEL_ORG_ID" ]; then TEAM_QS="&teamId=${VERCEL_ORG_ID}"; fi
    HTTP_CODE=$(curl -sS -o /tmp/vercel_env.json -w '%{http_code}' -X POST \
      "https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true${TEAM_QS}" \
      -H "Authorization: Bearer ${VERCEL_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"MOBILE_STOREFRONT_ANDROID_LATEST_BUILD\",\"value\":\"${VERSION_CODE}\",\"type\":\"encrypted\",\"target\":[\"production\"]}")
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
      echo "Synced MOBILE_STOREFRONT_ANDROID_LATEST_BUILD=${VERSION_CODE} (HTTP ${HTTP_CODE})"
    else
      echo "::warning::Vercel env sync failed (HTTP ${HTTP_CODE}): $(cat /tmp/vercel_env.json)"
    fi
    ;;
  reconcile-live-build)
    if [ -z "$CRON_SECRET" ]; then
      echo "::warning::CRON_SECRET is missing; skipping non-fatal storefront Android live-build gate reconciliation"
      exit 0
    fi

    if ! curl --fail-with-body --retry 3 --retry-all-errors --retry-delay 10 \
      --connect-timeout 10 \
      --max-time 60 \
      -H "Authorization: Bearer $CRON_SECRET" \
      "$ANDROID_LIVE_BUILD_SYNC_URL"; then
      echo "::warning::Storefront Android live-build gate reconciliation failed after Play upload; release remains published"
    fi
    ;;
  cleanup)
    rm -f "${ANDROID_STOREFRONT_KEYSTORE_FILE:-}"
    rm -f "apps/mobile-storefront/android/app/google-services.json"
    rm -f "apps/mobile-storefront/android/sentry.properties"
    ;;
  *)
    echo "::error::Unknown Android storefront release operation: $operation"
    exit 2
    ;;
esac
