#!/usr/bin/env bash
set -euo pipefail

operation="${1:-}"

case "$operation" in
  expose-posthog-cli)
    POSTHOG_CLI_PATH="$GITHUB_WORKSPACE/node_modules/.bin/posthog-cli"
    if [ ! -x "$POSTHOG_CLI_PATH" ]; then
      POSTHOG_CLI_PATH="$GITHUB_WORKSPACE/${WORKING_DIR}/node_modules/.bin/posthog-cli"
    fi

    if [ ! -x "$POSTHOG_CLI_PATH" ]; then
      echo "::error::posthog-cli is not available after pnpm install"
      exit 1
    fi

    mkdir -p "$HOME/.posthog"
    ln -sf "$POSTHOG_CLI_PATH" "$HOME/.posthog/posthog-cli"
    "$HOME/.posthog/posthog-cli" --version
    ;;
  resolve-build)
    if [ "$GH_EVENT_NAME" = "workflow_dispatch" ] && [ -n "$INPUT_BUILD_NUMBER" ]; then
      BUILD_NUMBER="$INPUT_BUILD_NUMBER"
    elif [ "$GH_REF_TYPE" = "tag" ]; then
      BUILD_NUMBER="${GH_REF_NAME#v}"
      BUILD_NUMBER="${BUILD_NUMBER%-storefront-ios}"
    else
      BUILD_NUMBER=$(( GH_RUN_NUMBER + BUILD_NUMBER_BASE ))
    fi

    if ! [[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
      echo "::error::Invalid build number '$BUILD_NUMBER'. Use a positive integer (>=1)."
      exit 1
    fi

    if ! [[ "$APP_VERSION_MAJOR_MINOR" =~ ^[0-9]+\.[0-9]+$ ]]; then
      echo "::error::Invalid APP_VERSION_MAJOR_MINOR '$APP_VERSION_MAJOR_MINOR'. Must match <major>.<minor> (e.g., 2.1)." >&2
      exit 1
    fi

    echo "IOS_BUILD_NUMBER=$BUILD_NUMBER" >> "$GITHUB_ENV"
    echo "IOS_APP_VERSION=${APP_VERSION_MAJOR_MINOR}.$BUILD_NUMBER" >> "$GITHUB_ENV"
    echo "build_number=$BUILD_NUMBER" >> "$GITHUB_OUTPUT"
    ;;
  materialize-firebase)
    if [ -n "$GOOGLE_SERVICES_PLIST_BASE64" ]; then
      umask 077
      echo "$GOOGLE_SERVICES_PLIST_BASE64" | base64 -d > GoogleService-Info.plist
      chmod 600 GoogleService-Info.plist
    elif [ -f GoogleService-Info.plist ]; then
      echo "Using tracked GoogleService-Info.plist"
    else
      echo "::error::Missing GoogleService-Info.plist and secret"
      exit 1
    fi
    ;;
  materialize-asc-key)
    if [ -z "$ASC_API_KEY_P8_BASE64" ] || [ -z "$ASC_API_KEY_ID" ] || [ -z "$ASC_API_ISSUER_ID" ]; then
      echo "::error::ASC_API_KEY_P8_BASE64, ASC_API_KEY_ID, and ASC_API_ISSUER_ID secrets must be set"
      exit 1
    fi
    KEY_DIR="$HOME/.appstoreconnect/private_keys"
    mkdir -p "$KEY_DIR"
    umask 077
    KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"
    echo "$ASC_API_KEY_P8_BASE64" | base64 -d > "$KEY_PATH"
    chmod 600 "$KEY_PATH"
    echo "ASC_API_KEY_PATH=$KEY_PATH" >> "$GITHUB_ENV"
    ;;
  configure-match-ssh)
    if [ -z "$MATCH_DEPLOY_KEY" ]; then
      echo "::error::MATCH_DEPLOY_KEY secret is required"
      exit 1
    fi
    mkdir -p ~/.ssh
    umask 077
    printf '%s\n' "$MATCH_DEPLOY_KEY" > ~/.ssh/match_deploy_key
    chmod 600 ~/.ssh/match_deploy_key
    ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
    echo "GIT_SSH_COMMAND=ssh -i ~/.ssh/match_deploy_key -o IdentitiesOnly=yes" >> "$GITHUB_ENV"
    ;;
  cleanup)
    rm -f "$HOME/.appstoreconnect/private_keys/AuthKey_"*.p8
    rm -f ~/.ssh/match_deploy_key
    security delete-keychain fastlane_match_keychain 2>/dev/null || true
    if ! git -C "$GITHUB_WORKSPACE" ls-files --error-unmatch "$WORKING_DIR/GoogleService-Info.plist" >/dev/null 2>&1; then
      rm -f "$GITHUB_WORKSPACE/$WORKING_DIR/GoogleService-Info.plist"
    fi
    ;;
  *)
    echo "::error::Unknown iOS storefront release operation: $operation"
    exit 2
    ;;
esac
