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
# command was never started, or when it is still running at the timeout; then it stops the command
# (its whole process group where `setsid` exists, as on the Linux runners) before exiting.
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
pidfile="$dir/$name.pid"

# The step's process tree: its group (setsid on Linux) when that exists, otherwise the PID and all
# its descendants, collected once so a child that outlives its parent is still tracked.
step_pids() {
  local queue=("$1") pids=() next
  while ((${#queue[@]})); do
    next="${queue[0]}"
    queue=("${queue[@]:1}")
    pids+=("$next")
    while read -r child; do [[ -n "$child" ]] && queue+=("$child"); done < <(pgrep -P "$next" 2> /dev/null || true)
  done
  echo "${pids[@]}"
}

# TERM first; KILL whatever ignores it after a 5 s grace period.
stop_step() {
  local leader="$1" pids alive pgid
  # Signal the whole group only when the leader is alive and really leads its own group (setsid);
  # a bare PGID number could belong to an unrelated group on a shared runner.
  pgid="$(ps -o pgid= -p "$leader" 2> /dev/null | tr -d ' ' || true)"
  if [[ -n "$pgid" && "$pgid" == "$leader" ]]; then
    kill -TERM -- "-$leader" 2> /dev/null || true
    for _ in $(seq 1 50); do kill -0 -- "-$leader" 2> /dev/null || return 0; sleep 0.1; done
    echo "background step still running 5s after TERM; sending KILL" >&2
    kill -KILL -- "-$leader" 2> /dev/null || true
    return 0
  fi
  read -r -a pids <<< "$(step_pids "$leader")"
  kill -TERM "${pids[@]}" 2> /dev/null || true
  for _ in $(seq 1 50); do
    alive=false
    for pid in "${pids[@]}"; do kill -0 "$pid" 2> /dev/null && alive=true; done
    [[ "$alive" == true ]] || return 0
    sleep 0.1
  done
  echo "background step still running 5s after TERM; sending KILL" >&2
  kill -KILL "${pids[@]}" 2> /dev/null || true
}

case "$action" in
  start)
    [[ $# -ge 1 ]] || usage
    mkdir -p "$dir"
    rm -f "$log" "$status"
    : > "$started"
    # The runner keeps background processes alive across steps and reaps them at job end
    # ("Cleaning up orphan processes"). The inner shell records the exit status atomically.
    # With setsid the command leads its own process group, so a timed-out `wait` can stop it and
    # everything it started (docker pull, pnpm) together.
    launcher=()
    command -v setsid > /dev/null 2>&1 && launcher=(setsid)
    # The inner shell writes its own PID ($$): under setsid it is the session and process-group
    # leader even if setsid had to fork, so `kill -- -PID` reaches every grandchild.
    rm -f "$pidfile"
    nohup ${launcher[@]+"${launcher[@]}"} bash -c 'echo $$ > "${0%.log}.pid"; "$@" > "$0" 2>&1; echo $? > "$0.status.tmp"; mv "$0.status.tmp" "${0%.log}.status"' \
      "$log" "$@" > /dev/null 2>&1 &
    launcher_pid=$!
    for _ in $(seq 1 50); do [[ -s "$pidfile" ]] && break; sleep 0.1; done
    if [[ ! -s "$pidfile" ]]; then
      echo "background step '$name' did not start (no PID after 5s)" >&2
      # A slow spawn must not turn into an orphan that nothing collects or stops.
      # Only while it is still our launcher: a forked setsid frees this PID, which may be reused.
      if ps -o args= -p "$launcher_pid" 2> /dev/null | grep -qF -- "$log"; then
        kill -KILL "$launcher_pid" 2> /dev/null || true
      fi
      rm -f "$started"
      exit 1
    fi
    echo "Started background step '$name'"
    ;;
  wait)
    timeout="${1:-900}"
    [[ "$timeout" =~ ^[0-9]+$ ]] || usage
    [[ -f "$started" ]] || { echo "background step '$name' was never started" >&2; exit 1; }
    waited=0
    while [[ ! -f "$status" ]]; do
      if (( waited >= timeout )); then
        echo "background step '$name' still running after ${timeout}s; stopping it" >&2
        # Only while that PID is still this step's shell (its arguments carry this step's log path),
        # never a process that reused the PID.
        if [[ -s "$pidfile" ]]; then
          pid="$(cat "$pidfile")"
          if ps -o args= -p "$pid" 2> /dev/null | grep -qF -- "$log"; then
            stop_step "$pid"
          fi
        fi
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
