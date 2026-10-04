#!/usr/bin/env bash
# All-runs promote barrier for the worker overlap exclusion. Sourced
# by check-deploy-workflow-inflight.sh, not executed.
#
# The ID-list record cannot see runs that start mid-stall: a workflow
# that starts after the pre-flip snapshot reads pre-flip state and can
# clear every overlap check while the post-flip refresh hangs. The
# barrier closes that hole: the pre-flip write raises a per-deploy
# file (barriers/<sha>-<host>-<pid>) in the SAME ops-branch commit as
# the record, and the post-flip/restore writes clear it. The
# workflow's overlap script refuses while ANY barrier file exists.
# Presence, not a generation scalar: a generation bumped pre-flip
# advertises unflipped state (torn capture passes), and one bumped
# post-flip lags during the very stall it must cover. Per-deploy
# files (not one flag) so concurrent deploys never clear each other;
# a crashed deploy's file sticks until manually cleared (the refusing
# message points at the runbook), which fails safe. All git here is
# plumbing (the record branch has no checkout): trees are rebuilt
# entry-by-entry, preserving unrelated files.

# Prints the per-deploy barrier file name for a promote. Stable
# across the deploy's three record calls (same process, same SHA);
# unique across deploys (SHA + host + PID). PROMOTE_BARRIER_ID_SUFFIX
# overrides the suffix for tests (each test shell has its own PID).
promote_barrier_id() {
  barrier_sha="$1"
  if [ -n "${PROMOTE_BARRIER_ID_SUFFIX:-}" ]; then
    printf '%s-%s\n' "$barrier_sha" "$PROMOTE_BARRIER_ID_SUFFIX"
    return 0
  fi
  barrier_host="$(hostname 2>/dev/null || echo unknown)"
  barrier_host="$(printf '%s' "$barrier_host" | tr -c 'A-Za-z0-9.-' '_')"
  printf '%s-%s-%s\n' "$barrier_sha" "$barrier_host" "$$"
}

# Prints the barriers subtree SHA after raising (pre) or clearing
# (post/restore) this deploy's file; prints nothing when the subtree
# is empty (omitted: an empty dir cannot exist in git, so its absence
# reads as clear). Siblings (concurrent deploys) are preserved.
_promote_barriers_tree() {
  barrier_phase="$1"
  barrier_id="$2"
  barrier_sha="$3"
  barrier_base="$4"
  barrier_tab=$'\t'
  barrier_input=""
  barrier_entry=""
  barrier_name=""
  barrier_blob=""
  if [ -n "$barrier_base" ]; then
    while IFS= read -r -d '' barrier_entry; do
      barrier_name="${barrier_entry#*$'\t'}"
      # Drop this deploy's stale entry (re-raised below on pre);
      # keep every sibling. Verbatim: ls-tree -z output matches the
      # mktree input format exactly.
      if [ "$barrier_name" != "$barrier_id" ]; then
        barrier_input="${barrier_input}${barrier_entry}"$'\n'
      fi
    done < <(git ls-tree -z "$barrier_base:barriers" 2>/dev/null || true)
  fi
  if [ "$barrier_phase" = "pre" ]; then
    barrier_blob="$(printf '%s\n' "$barrier_sha" | git hash-object -w --stdin)" || return 1
    barrier_input="${barrier_input}100644 blob ${barrier_blob}"$'\t'"${barrier_id}"$'\n'
  fi
  if [ -z "$barrier_input" ]; then
    return 0
  fi
  printf '%s' "$barrier_input" | LC_ALL=C sort -t "$barrier_tab" -k2,2 | git mktree || return 1
}

# Prints the ops-branch root tree SHA for a record write: the record
# blob plus the barriers subtree, preserving any other entries.
# Base ref empty = first record (no history to preserve).
promote_record_tree() {
  record_blob="$1"
  record_phase_name="$2"
  record_tree_sha="$3"
  record_base="$4"
  record_barrier_id=""
  record_barriers_tree=""
  record_input=""
  record_entry=""
  record_name=""
  record_tab=$'\t'
  record_barrier_id="$(promote_barrier_id "$record_tree_sha")" || return 1
  record_barriers_tree="$(_promote_barriers_tree "$record_phase_name" "$record_barrier_id" "$record_tree_sha" "$record_base")" || return 1
  record_input="100644 blob ${record_blob}"$'\t'"${PROMOTE_RECORD_FILE}"$'\n'
  if [ -n "$record_barriers_tree" ]; then
    record_input="${record_input}040000 tree ${record_barriers_tree}"$'\t'"barriers"$'\n'
  fi
  if [ -n "$record_base" ]; then
    while IFS= read -r -d '' record_entry; do
      record_name="${record_entry#*$'\t'}"
      case "$record_name" in
        "$PROMOTE_RECORD_FILE" | barriers) ;; # replaced/rebuilt above
        *) record_input="${record_input}${record_entry}"$'\n' ;;
      esac
    done < <(git ls-tree -z "$record_base" 2>/dev/null || true)
  fi
  printf '%s' "$record_input" | LC_ALL=C sort -t "$record_tab" -k2,2 | git mktree || return 1
}
