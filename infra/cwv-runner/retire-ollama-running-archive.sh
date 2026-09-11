#!/bin/sh
RUNNING_CONTAINER_IMAGE_MAX_BYTES=1073741824
RUNNING_CONTAINER_FILESYSTEM_MAX_BYTES=4294967296
# shellcheck disable=SC2034 # Consumed by the running-container helper after sourcing.
RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS=300
# shellcheck disable=SC2034 # Consumed by the running-container helper after sourcing.
RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS=600

running_container_now() { /bin/date +%s; }

RUNNING_CONTAINER_ARCHIVE_WORKER=
running_container_archive_signal() {
  running_archive_signal_status=$1
  trap - EXIT HUP INT TERM
  if [ -n "${RUNNING_CONTAINER_ARCHIVE_WORKER:-}" ]; then
    running_container_stop_workers "$RUNNING_CONTAINER_ARCHIVE_WORKER" || :
    running_archive_signal_pid=$(running_container_worker_pid "$RUNNING_CONTAINER_ARCHIVE_WORKER" 2>/dev/null) || running_archive_signal_pid=''
    [ -z "$running_archive_signal_pid" ] || wait "$running_archive_signal_pid" 2>/dev/null || :
    RUNNING_CONTAINER_ARCHIVE_WORKER=
  fi
  cleanup_temp >/dev/null 2>&1 || :
  exit "$running_archive_signal_status"
}

running_container_archive_with_signal_traps() {
  running_archive_saved_traps=$(trap)
  trap 'running_container_archive_signal 129' HUP
  trap 'running_container_archive_signal 130' INT
  trap 'running_container_archive_signal 143' TERM
  "$@"; running_archive_operation_status=$?
  trap - HUP INT TERM
  [ -z "$running_archive_saved_traps" ] || eval "$running_archive_saved_traps"
  return "$running_archive_operation_status"
}

running_container_worker_pid() {
  running_worker=$1
  case "$running_worker" in group:*) running_worker_pid=${running_worker#group:};; *) running_worker_pid=$running_worker;; esac
  case "$running_worker_pid" in ''|0|*[!0-9]*) return 2;; esac
  printf '%s\n' "$running_worker_pid"
}

running_container_worker_signal() {
  running_signal=$1; running_worker=$2
  running_worker_pid=$(running_container_worker_pid "$running_worker") || return 2
  case "$running_worker" in
    group:*)
      running_signal_status=1
      /bin/kill "-$running_signal" -- "$running_worker_pid" 2>/dev/null && running_signal_status=0
      /bin/kill "-$running_signal" -- "-$running_worker_pid" 2>/dev/null && running_signal_status=0
      return "$running_signal_status"
      ;;
    *) /bin/kill "-$running_signal" -- "$running_worker_pid" 2>/dev/null;;
  esac
}

running_container_worker_alive() {
  running_worker_pid=$(running_container_worker_pid "$1") || return 2
  case "$1" in
    group:*) /bin/kill -0 -- "$running_worker_pid" 2>/dev/null || /bin/kill -0 -- "-$running_worker_pid" 2>/dev/null;;
    *) /bin/kill -0 -- "$running_worker_pid" 2>/dev/null;;
  esac
}

running_container_stop_workers() {
  for running_worker do running_container_worker_signal TERM "$running_worker" || :; done
  /bin/sleep 1
  for running_worker do running_container_worker_alive "$running_worker" && running_container_worker_signal KILL "$running_worker" || :; done
}

running_container_wait_group() {
  running_group_deadline=$1
  case "$running_group_deadline" in ''|*[!0-9]*) return 2;; esac
  shift
  running_group_pids=''; running_group_workers=''; running_group_files=''; running_group_mode=pids
  for running_group_arg do
    if [ "$running_group_arg" = -- ]; then running_group_mode=files; continue; fi
    if [ "$running_group_mode" = pids ]; then running_group_pid=$(running_container_worker_pid "$running_group_arg") || return 2; running_group_pids="$running_group_pids $running_group_pid"; running_group_workers="$running_group_workers $running_group_arg"; else running_group_files="$running_group_files $running_group_arg"; fi
  done
  while :; do
    running_group_now=$(running_container_now) || {
      # shellcheck disable=SC2086 # The validated internal value is a PID list.
      running_container_stop_workers $running_group_workers
      for running_group_pid in $running_group_pids; do wait "$running_group_pid" 2>/dev/null || :; done
      return 124
    }
    if [ "$running_group_now" -ge "$running_group_deadline" ]; then
      # shellcheck disable=SC2086 # The validated internal value is a PID list.
      running_container_stop_workers $running_group_workers
      for running_group_pid in $running_group_pids; do wait "$running_group_pid" 2>/dev/null || :; done
      return 124
    fi
    running_group_complete=1
    for running_group_file in $running_group_files; do [ -s "$running_group_file" ] || running_group_complete=0; done
    if [ "$running_group_complete" -eq 1 ]; then
      running_group_running=0
      for running_group_worker in $running_group_workers; do running_container_worker_alive "$running_group_worker" && running_group_running=1; done
      if [ "$running_group_running" -eq 0 ]; then
        running_group_status=0
        for running_group_pid in $running_group_pids; do wait "$running_group_pid" 2>/dev/null || running_group_status=$?; done
        [ "$running_group_status" -eq 0 ] && return 0
        return "$running_group_status"
      fi
    fi
    sleep 1
  done
}

running_container_archive_docker() {
  RUNNING_CONTAINER_DOCKER=''
  if [ "$(/usr/bin/id -u)" -eq 0 ]; then
    [ -f /usr/bin/docker ] && [ ! -L /usr/bin/docker ] && [ -x /usr/bin/docker ] || return 2
    RUNNING_CONTAINER_DOCKER=/usr/bin/docker
  elif [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] && [ -f "$RETIRE_OLLAMA_TEST_BIN/docker" ] && [ ! -L "$RETIRE_OLLAMA_TEST_BIN/docker" ] && [ -x "$RETIRE_OLLAMA_TEST_BIN/docker" ]; then
    RUNNING_CONTAINER_DOCKER=$RETIRE_OLLAMA_TEST_BIN/docker
  else
    return 2
  fi
}

running_container_archive_group_start() {
  RUNNING_CONTAINER_ARCHIVE_WORKER=; running_start_kind=$1; running_start_id=$2; running_start_output=$3
  running_container_archive_docker || return 2
  running_start_docker=$RUNNING_CONTAINER_DOCKER
  case "$running_start_kind" in
    image) set -- "$running_start_docker" --host "unix://$CANONICAL_DOCKER_SOCKET" image save "$running_start_id";;
    container) set -- "$running_start_docker" --host "unix://$CANONICAL_DOCKER_SOCKET" container export "$running_start_id";;
    *) return 2;;
  esac
  running_start_ready=$(temp_path) || return 2
  exec 3>"$running_start_ready" || { rm -f "$running_start_ready"; return 2; }
  (
    exec /usr/bin/perl -MPOSIX -MFcntl=O_WRONLY,O_NOFOLLOW -e '
    my ($parent, $output, @command) = @ARGV; $parent =~ /^\d+$/ && $parent > 1 or exit 2;
    POSIX::getpgrp() == $$ and exit 2;
    my $session = POSIX::setsid();
    defined($session) && $session == $$ or exit 2;
    open(my $ready, ">&=3") or exit 2;
    my $released = 0;
    $SIG{USR1} = sub { $released = 1 };
    syswrite($ready, "ready\n") == 6 or exit 2;
    close($ready) or exit 2;
    while (!$released) { getppid == $parent or exit 2; select undef, undef, undef, 0.01 }
    sysopen(STDOUT, $output, O_WRONLY | O_NOFOLLOW) or exit 2;
    my @output_stat = stat(STDOUT);
    @output_stat && -p _ or exit 2;
    my $worker = fork(); defined $worker or exit 2; if (!$worker) { exec {$command[0]} @command; exit 2 }
    while (1) { my $done = waitpid($worker, POSIX::WNOHANG()); exit($? >> 8) if $done == $worker; if (getppid != $parent) { local $SIG{TERM} = "IGNORE"; kill "TERM", -$$; waitpid($worker, 0); exit 2 } select undef, undef, undef, 0.01 }
  ' "$$" "$running_start_output" "$@"
  ) 2>/dev/null &
  running_start_pid=$!
  RUNNING_CONTAINER_ARCHIVE_WORKER=group:$running_start_pid
  exec 3>&-
  running_start_attempt=0
  while [ "$running_start_attempt" -lt 100 ]; do
    running_start_pgid=$(/bin/ps -o pgid= -p "$running_start_pid" 2>/dev/null | /usr/bin/tr -d '[:space:]') || running_start_pgid=''
    if [ -s "$running_start_ready" ] && [ "$(cat "$running_start_ready" 2>/dev/null)" = ready ] && [ "$running_start_pgid" = "$running_start_pid" ]; then
      /bin/kill -USR1 "$running_start_pid" 2>/dev/null || { /bin/kill -KILL "$running_start_pid" 2>/dev/null || :; wait "$running_start_pid" 2>/dev/null || :; RUNNING_CONTAINER_ARCHIVE_WORKER=; rm -f "$running_start_ready"; return 2; }
      rm -f "$running_start_ready"
      return 0
    fi
    /bin/kill -0 "$running_start_pid" 2>/dev/null || { wait "$running_start_pid" 2>/dev/null || :; RUNNING_CONTAINER_ARCHIVE_WORKER=; rm -f "$running_start_ready"; return 2; }
    running_start_attempt=$((running_start_attempt + 1))
    /bin/sleep 0.01
  done
  /bin/kill -KILL "$running_start_pid" 2>/dev/null || :
  wait "$running_start_pid" 2>/dev/null || :
  RUNNING_CONTAINER_ARCHIVE_WORKER=
  rm -f "$running_start_ready"
  return 2
}

running_container_archive_command() {
  running_archive_docker=''
  case "$1" in
    image|container) running_container_archive_docker || return 2; running_archive_docker=$RUNNING_CONTAINER_DOCKER ;;
    *) return 2;;
  esac
  case "$1" in
    image) "$running_archive_docker" --host "unix://$CANONICAL_DOCKER_SOCKET" image save "$2" ;;
    container) "$running_archive_docker" --host "unix://$CANONICAL_DOCKER_SOCKET" container export "$2" ;;
    *) return 2 ;;
  esac
}

running_container_archive_limit() {
  case "$1" in
    image) printf '%s\n' "$RUNNING_CONTAINER_IMAGE_MAX_BYTES" ;;
    container) printf '%s\n' "$RUNNING_CONTAINER_FILESYSTEM_MAX_BYTES" ;;
    *) return 2 ;;
  esac
}

running_container_archive_hash_tool() {
  if [ "${RETIRE_OLLAMA_TEST_FSTYPE:-}" = apfs ] && [ -f /usr/bin/shasum ] && [ ! -L /usr/bin/shasum ] && [ -x /usr/bin/shasum ]; then
    printf '%s\n' /usr/bin/shasum
  elif [ -f /usr/bin/sha256sum ] && [ ! -L /usr/bin/sha256sum ] && [ -x /usr/bin/sha256sum ]; then
    printf '%s\n' /usr/bin/sha256sum
  else
    return 2
  fi
}

running_container_archive_save_bounded_impl() {
  running_save_kind=$1; running_save_id=$2; running_save_output=$3; running_save_fifo=$4; running_save_status=$5; running_save_deadline=$6
  running_save_limit=$(running_container_archive_limit "$running_save_kind") || return 2
  rm -f "$running_save_output" "$running_save_fifo" "$running_save_status"
  mkfifo "$running_save_fifo" || return 2
  : >"$running_save_status" || { rm -f "$running_save_fifo"; return 2; }
  running_container_archive_group_start "$running_save_kind" "$running_save_id" "$running_save_fifo" || { rm -f "$running_save_fifo"; return 2; }
  running_save_worker=$RUNNING_CONTAINER_ARCHIVE_WORKER
  /usr/bin/perl -e '
    my ($output, $status, $limit) = @ARGV; binmode STDIN; open my $fh, ">", $output or exit 2; binmode $fh;
    my ($total, $ok) = (0, 1); while (1) { my $read = read(STDIN, my $chunk, 65536); defined $read or $ok = 0, last; last unless $read; $total += $read; if ($total > $limit) { $ok = 0; last; } print {$fh} $chunk or $ok = 0; last unless $ok; }
    close $fh or $ok = 0; open my $sf, ">", $status or exit 2; print {$sf} ($ok ? "0\n" : "2\n") or $ok = 0; close $sf or $ok = 0; exit($ok ? 0 : 2);
  ' "$running_save_output" "$running_save_status" "$running_save_limit" <"$running_save_fifo" &
  running_save_reader_pid=$!
  running_container_wait_group "$running_save_deadline" "$running_save_reader_pid" "$running_save_worker" -- "$running_save_status"; running_save_group_status=$?
  RUNNING_CONTAINER_ARCHIVE_WORKER=
  rm -f "$running_save_fifo"
  [ "$running_save_group_status" -eq 0 ] && [ "$(cat "$running_save_status" 2>/dev/null)" = 0 ] && [ -s "$running_save_output" ] || return 2
}

running_container_archive_save_bounded() { running_container_archive_with_signal_traps running_container_archive_save_bounded_impl "$@"; }

running_container_archive_hash_stream_impl() {
  running_hash_kind=$1; running_hash_id=$2; running_hash_output=$3; running_hash_fifo=$4; running_hash_status_file=$5; running_hash_deadline=$6
  running_hash_limit=$(running_container_archive_limit "$running_hash_kind") || return 2
  running_hash_tool=$(running_container_archive_hash_tool) || return 2
  running_hash_digest_fifo=$(temp_path)
  rm -f "$running_hash_fifo" "$running_hash_digest_fifo" "$running_hash_output" "$running_hash_status_file"
  mkfifo "$running_hash_fifo" "$running_hash_digest_fifo" || return 2
  : >"$running_hash_status_file" || { rm -f "$running_hash_fifo" "$running_hash_digest_fifo"; return 2; }
  running_container_archive_group_start "$running_hash_kind" "$running_hash_id" "$running_hash_fifo" || { rm -f "$running_hash_fifo" "$running_hash_digest_fifo"; return 2; }
  running_hash_worker=$RUNNING_CONTAINER_ARCHIVE_WORKER
  if [ "$running_hash_tool" = /usr/bin/shasum ]; then
    "$running_hash_tool" -a 256 "$running_hash_digest_fifo" >"$running_hash_output" 2>/dev/null &
  else
    "$running_hash_tool" "$running_hash_digest_fifo" >"$running_hash_output" 2>/dev/null &
  fi
  running_hash_sum_pid=$!
  /usr/bin/perl -e '
    my ($status, $limit) = @ARGV; binmode STDIN; my ($total, $ok) = (0, 1);
    while (1) { my $read = read(STDIN, my $chunk, 65536); defined $read or $ok = 0, last; last unless $read; $total += $read; if ($total > $limit) { $ok = 0; last; } print $chunk or $ok = 0; last unless $ok; }
    close STDOUT or $ok = 0; open my $sf, ">", $status or exit 2; print {$sf} ($ok ? "0\n" : "2\n") or $ok = 0; close $sf or $ok = 0; exit($ok ? 0 : 2);
  ' "$running_hash_status_file" "$running_hash_limit" <"$running_hash_fifo" >"$running_hash_digest_fifo" 2>/dev/null &
  running_hash_reader_pid=$!
  running_container_wait_group "$running_hash_deadline" "$running_hash_reader_pid" "$running_hash_sum_pid" "$running_hash_worker" -- "$running_hash_status_file" "$running_hash_output"; running_hash_group_status=$?
  RUNNING_CONTAINER_ARCHIVE_WORKER=
  rm -f "$running_hash_fifo" "$running_hash_digest_fifo"
  [ "$running_hash_group_status" -eq 0 ] && [ "$(cat "$running_hash_status_file" 2>/dev/null)" = 0 ] || return 2
  IFS=' ' read -r running_hash_value _ <"$running_hash_output" || return 2
  printf '%s\n' "$running_hash_value" | grep -Eq '^[0-9a-f]{64}$' || return 2
  printf '%s\n' "$running_hash_value"
}

running_container_archive_hash_stream() { running_container_archive_with_signal_traps running_container_archive_hash_stream_impl "$@"; }
