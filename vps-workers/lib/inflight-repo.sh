#!/usr/bin/env bash
# Origin-remote resolution for the worker deploy guard. Sourced by
# check-deploy-workflow-inflight.sh (split out under the Boy Scout
# Rule: the guard exceeded 300 lines). Every function here RETURNS
# its status and never exits, like the rest of the guard.

_is_valid_repo_slug() {
  # Exactly one slash, non-empty owner and repo. Two case stages: the
  # first rejects empties and extras, the second requires the slash
  # (a lone `*` fallback would accept a slash-less value and split it
  # into owner=repo=itself).
  case "$1" in
    */*/* | /* | */ | "") return 1 ;;
  esac
  case "$1" in
    */*) return 0 ;;
    *) return 1 ;;
  esac
}

_set_inflight_repo() {
  # Resolve the repo explicitly: gh follows the checkout's remotes,
  # so a fork-clone deploy would query the fork (no runs) and pass
  # vacuously. Fail closed; the override covers exotic setups.
  if [ -n "${BACI_DEPLOY_WORKFLOW_REPO:-}" ]; then
    if ! _is_valid_repo_slug "$BACI_DEPLOY_WORKFLOW_REPO"; then
      echo "Refusing worker promotion: BACI_DEPLOY_WORKFLOW_REPO must be 'owner/repo', got '$BACI_DEPLOY_WORKFLOW_REPO'." >&2
      return 1
    fi
    _inflight_owner="${BACI_DEPLOY_WORKFLOW_REPO%%/*}"
    _inflight_repo="${BACI_DEPLOY_WORKFLOW_REPO#*/}"
    return 0
  fi
  inflight_remote="$(git remote get-url origin 2>/dev/null || true)"
  # A '#' starts a URL fragment, so https://evil.com#@github.com/org/repo
  # has host evil.com while a strip-to-last-'@' would forge a github.com
  # match. Legitimate remotes never contain a fragment marker: refuse.
  case "$inflight_remote" in
    *'#'*) echo 'Refusing worker promotion: origin URL must not contain a fragment.' >&2; return 1 ;;
  esac
  # Schemes are case-insensitive and the coordinator matches them
  # case-insensitively (URL normalizes Https:, the SSH regex has /i):
  # lowercase scheme:// so SSH:// and Https:// reach the right arm.
  # scp-like remotes contain no '://' and pass through untouched.
  case "$inflight_remote" in
    *://*)
      _remote_scheme_part="${inflight_remote%%://*}"
      inflight_remote="$(printf '%s' "$_remote_scheme_part" | tr '[:upper:]' '[:lower:]')://${inflight_remote#*://}"
      ;;
  esac
  # Normalize credential-bearing and trailing-slash HTTPS spellings to
  # the same canonical form the coordinator accepts. Credentials must
  # never reach the match below or the error message after it.
  # Plaintext http is refused like the coordinator: releases require
  # https or ssh.
  case "$inflight_remote" in
    https://*)
      _remote_scheme="${inflight_remote%%://*}"
      _remote_rest="${inflight_remote#*://}"
      _remote_host="${_remote_rest%%/*}"
      case "$_remote_host" in
        *@*) _remote_host="${_remote_host##*@}" ;;
      esac
      # Hostnames are case-insensitive and the coordinator matches
      # github.com case-insensitively: lowercase (via tr, since macOS
      # ships bash 3 without ${var,,}) or a GitHub.com remote passes
      # validation then aborts the worker deploy as unresolvable.
      _remote_host="$(printf '%s' "$_remote_host" | tr '[:upper:]' '[:lower:]')"
      # Strip the default HTTPS port, which the coordinator's URL
      # parse normalizes away: github.com:443 must resolve, while any
      # other port falls through to the refusal below.
      case "$_remote_host" in
        *:443) _remote_host="${_remote_host%:443}" ;;
      esac
      _remote_path="${_remote_rest#*/}"
      if [ "$_remote_path" = "$_remote_rest" ]; then
        _remote_path=""
      else
        _remote_path="/${_remote_path}"
      fi
      inflight_remote="${_remote_scheme}://${_remote_host}${_remote_path}"
      ;;
    git@*:*)
      # scp-like: lowercase user@host (before the first colon) so
      # git@GitHub.com resolves like the case-insensitive coordinator
      # match. The path stays case-sensitive.
      _scp_head="${inflight_remote%%:*}"
      _scp_tail="${inflight_remote#*:}"
      inflight_remote="$(printf '%s' "$_scp_head" | tr '[:upper:]' '[:lower:]'):${_scp_tail}"
      ;;
    ssh://*)
      # Lowercase scheme://authority; the path stays case-sensitive.
      _ssh_rest="${inflight_remote#*://}"
      _ssh_head="${_ssh_rest%%/*}"
      _ssh_tail="${_ssh_rest#*/}"
      if [ "$_ssh_tail" = "$_ssh_rest" ]; then
        _ssh_tail=""
      else
        _ssh_tail="/${_ssh_tail}"
      fi
      inflight_remote="ssh://$(printf '%s' "$_ssh_head" | tr '[:upper:]' '[:lower:]')${_ssh_tail}"
      ;;
  esac
  while :; do
    case "$inflight_remote" in
      */) inflight_remote="${inflight_remote%/}" ;;
      *) break ;;
    esac
  done
  inflight_repo=""
  case "$inflight_remote" in
    https://github.com/* | git@github.com:* | ssh://git@github.com/*)
      inflight_repo="${inflight_remote%.git}"
      inflight_repo="${inflight_repo##*github.com[:/]}"
      ;;
  esac
  if ! _is_valid_repo_slug "$inflight_repo"; then
    echo "Refusing worker promotion: cannot resolve the deploy repo from origin '$inflight_remote'. Run from a clean clone of the production repo, or set BACI_DEPLOY_WORKFLOW_REPO=owner/repo." >&2
    return 1
  fi
  _inflight_owner="${inflight_repo%%/*}"
  _inflight_repo="${inflight_repo#*/}"
}
