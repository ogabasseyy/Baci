#!/usr/bin/env bash
# Run a slow, self-contained CI command in the background and collect it in a later step, so the
# steps in between run at the same time. The command must not write $GITHUB_ENV, $GITHUB_PATH or
# $GITHUB_OUTPUT (a background write lands in whichever step is running then).
#
#   background-step.sh start <name> <command> [args...]
#   background-step.sh wait  <name> [timeout-seconds]   # default 900
#
# The timeout counts from `wait`, not from `start`: time the command already ran during the
# overlapped steps is not included. The job's timeout-minutes still bounds the total.
#
# `wait` prints the command's output and exits with the command's exit status. It fails when the
# command was never started, or when it is still running at the timeout.
set -euo pipefail

usage() {
  echo "usage: $0 start <name> <command> [args...] | wait <name> [timeout-seconds]" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
action="$1"
name="$2"
shift 2
[[ "$name" =~ ^[a-z0-9-]+$ ]] || { echo "invalid background step name: $name" >&2; exit 2; }
dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/background-steps"
log="$dir/$name.log"
status="$dir/$name.status"
started="$dir/$name.started"

case "$action" in
  start)
    [[ $# -ge 1 ]] || usage
    mkdir -p "$dir"
    rm -f "$log" "$status"
    : > "$started"
    # The runner keeps background processes alive across steps and reaps them at job end
    # ("Cleaning up orphan processes"). The inner shell records the exit status atomically.
    nohup bash -c '"$@" > "$0" 2>&1; echo $? > "$0.status.tmp"; mv "$0.status.tmp" "${0%.log}.status"' \
      "$log" "$@" > /dev/null 2>&1 &
    echo "Started background step '$name'"
    ;;
  wait)
    timeout="${1:-900}"
    [[ "$timeout" =~ ^[0-9]+$ ]] || usage
    [[ -f "$started" ]] || { echo "background step '$name' was never started" >&2; exit 1; }
    waited=0
    while [[ ! -f "$status" ]]; do
      if (( waited >= timeout )); then
        echo "background step '$name' still running after ${timeout}s" >&2
        [[ -f "$log" ]] && cat "$log"
        exit 1
      fi
      sleep 1
      waited=$((waited + 1))
    done
    [[ -f "$log" ]] && cat "$log"
    code="$(cat "$status")"
    echo "Background step '$name' finished with exit status $code (waited ${waited}s here)"
    exit "$code"
    ;;
  *)
    usage
    ;;
esac
