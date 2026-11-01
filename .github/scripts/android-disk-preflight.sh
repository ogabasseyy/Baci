#!/usr/bin/env bash
# Arguments are repeated triples: required bytes, non-secret label, directory.
# Budgets sharing a filesystem are summed so parallel consumers have headroom.
set -euo pipefail
export LC_ALL=C

fail() { printf 'Android disk preflight: %s\n' "$1" >&2; exit 1; }
[[ $# -ge 3 && $(($# % 3)) -eq 0 ]] || fail 'expected required-bytes label directory triples'

count=0
devices=()
mounts=()
available=()
required=()
labels=()
while [[ $# -gt 0 ]]; do
  bytes=$1
  label=$2
  target=$3
  shift 3
  [[ $bytes =~ ^[0-9]{1,15}$ ]] || fail "invalid byte threshold for $label"
  [[ $label =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'invalid path label'
  [[ -d $target && -r $target && -x $target ]] || fail "directory unavailable: $label"
  bytes=$((10#$bytes))
  (( bytes > 0 )) || fail "invalid byte threshold for $label"
  # POSIX -P emits one record even when the device name is long. Parse the
  # fixed first five fields and preserve whitespace in the mount name.
  info=$(df -Pk "$target" | awk 'NR == 2 && NF >= 6 { mount=$6; for (i=7;i<=NF;i++) mount=mount " " $i; print $1 "\t" $4 "\t" mount }') || fail "cannot measure filesystem: $label"
  IFS=$'\t' read -r device free_kib mount <<< "$info"
  [[ -n ${device:-} && -n ${mount:-} && ${free_kib:-} =~ ^[0-9]{1,12}$ ]] || fail "cannot measure filesystem: $label"
  free_bytes=$((10#$free_kib * 1024))
  found=-1
  for ((i=0; i<count; i++)); do
    if [[ ${devices[i]} == "$device" ]]; then found=$i; break; fi
  done
  if (( found < 0 )); then
    found=$count
    devices[found]=$device
    mounts[found]=$mount
    available[found]=$free_bytes
    required[found]=0
    labels[found]=$label
    count=$((count + 1))
  else
    (( free_bytes >= available[found] )) || available[found]=$free_bytes
    labels[found]="${labels[found]},$label"
  fi
  required[found]=$((required[found] + bytes))
  (( required[found] <= 9000000000000000 )) || fail 'combined byte threshold is too large'
done

for ((i=0; i<count; i++)); do
  summary="filesystem=${devices[i]} mount=${mounts[i]} paths=${labels[i]} available=${available[i]} bytes required=${required[i]} bytes"
  if (( available[i] < required[i] )); then
    fail "insufficient disk space: $summary; expand capacity or ask the runner operator to free space"
  fi
  printf 'Android disk preflight: %s\n' "$summary"
done
