"""Pinned future private base-fetch sequence; activated in a later change."""

PRIVATE_ENV = "        env:\n          GH_TOKEN: ${{ github.token }}\n"
PRIVATE_RUN = """            base_sha=$(jq -r .pull_request.base.sha "$GITHUB_EVENT_PATH")
            printf '%s' "$base_sha" | LC_ALL=C grep -Eq '^[0-9a-f]{40}$'
            [ "$GITHUB_SERVER_URL" = "https://github.com" ]
            [ "$(jq -r .repository.full_name "$GITHUB_EVENT_PATH")" = "$GITHUB_REPOSITORY" ]
            umask 077
            ask_dir=$(mktemp -d)
            trap 'rm -rf "$ask_dir"' EXIT
            askpass="$ask_dir/askpass"
            # shellcheck disable=SC2016 # The helper expands the token only when Git runs it.
            printf '%s\\n' '#!/bin/sh' 'case "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$GH_TOKEN" ;; esac' > "$askpass"
            chmod 700 "$askpass"
            GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git -c credential.helper= fetch --no-tags --depth 1 "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git" "$base_sha"
            unset GH_TOKEN
            rm -rf "$ask_dir"
            trap - EXIT
"""
PRIVATE_RUN_LINES = [line.strip() for line in PRIVATE_RUN.splitlines() if not line.strip().startswith("#")]
