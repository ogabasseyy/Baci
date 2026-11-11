#!/usr/bin/env bash
# Vote helpers for the Diff Guardian tally. Sourced by tally.sh; defines functions only.
# Needs in the environment: REPO and SHA (the head commit being tallied), and GH_TOKEN for `gh`.
# shellcheck disable=SC2154  # REPO and SHA come from the environment of the sourcing script

# A voter can report either as a commit status (external services) or
# as a check run (GitHub Actions). Gemini reports both; Muse reports
# only a check run (always green, it is advisory). Read both current
# GitHub API surfaces so a check-only voter cannot be mistaken as missing.
status_state() {
  printf '%s' "$1" | jq -r --arg c "$2" \
    '([.statuses[] | select(.context==$c)] | sort_by(.updated_at) | last | .state) // "missing"'
}

# A completed check that did not clearly pass or fail (timed_out,
# cancelled, action_required, skipped, stale, startup_failure, …) is an
# ABSTENTION, not a blocking vote — a reviewer outage must never block.
# A skipped run says nothing about the reviewer (a PR title/body edit starts one that
# is skipped at once), so it is ignored whenever a real run for the commit exists.
check_state() {
  printf '%s' "$1" | jq -r --arg c "$2" '
    [.check_runs[] | select(.name==$c)] as $all
    | ([$all[] | select((.conclusion // "") != "skipped")]) as $real
    | ((if ($real | length) > 0 then $real else $all end)
      | sort_by(.completed_at // .started_at // .created_at // "")
      | last) as $run
    | if $run == null then "missing"
      elif $run.status != "completed" then "pending"
      elif ($run.conclusion // "") == "success" then "success"
      elif ($run.conclusion // "") == "neutral" then "success"
      elif ($run.conclusion // "") == "failure" then "failure"
      else "abstain"
      end
  '
}

# Muse is advisory: its job is always green and it posts no status, so
# its vote is read from the review it posted for THIS head commit (the
# marker on the review's first line names the commit). Only the model-free
# structure counts: a top-level (unindented) "- critical:" / "- high:" bullet
# inside the LAST "## Findings" section, and not one Muse itself labels
# "unverified" (its path is not in the changed files). Text a pull request can
# influence (the verdict, indented finding bodies, the next steps) never counts.
# A fallback review ("Muse did not review") or no review at all abstains.
muse_review_vote() { # reviews-json
  printf '%s' "$1" | jq -r --arg sha "$SHA" '
    [.[] | select(.user.login == "github-actions[bot]"
      and ((.body // "") | startswith("<!-- muse-code-review sha:" + $sha + " ")))]
    | sort_by(.submitted_at) | last as $review
    | if $review == null then "abstain"
      elif (($review.body | split("\n") | .[1] // "") == "<!-- muse-fallback:v1 -->") then "abstain"
      else
        ($review.body | split("\n")) as $lines
        | ([range(0; ($lines | length)) | select($lines[.] == "## Findings")] | last) as $start
        | (if $start == null then [] else $lines[($start + 1):] end) as $rest
        | ([range(0; ($rest | length)) | select($rest[.] == "## Suggested next steps")] | first) as $stop
        | (if $stop == null then $rest else $rest[0:$stop] end)
        | if any(.[]; test("^[-*][ \t]+(critical|high)[ \t]*:"; "i") and (test("unverified\\)$") | not))
          then "failure" else "success" end
      end'
}

# Combine the surfaces into one vote. A real success/failure wins;
# otherwise pending (still running) outranks abstain (done, no verdict)
# outranks missing (never appeared). A commit-status "error" means the
# reviewer could not review (quota, outage): an abstention that also
# overrides a red check run, never a blocking vote.
voter_state() { # statuses-json checks-json context reviews-json
  local cs cr
  cs="$(status_state "$1" "$3")"
  cr="$(check_state "$2" "$3")"
  case "$cs" in
    success|failure)
      printf '%s' "$cs"
      return
      ;;
    error)
      printf 'abstain'
      return
      ;;
  esac
  if [ "$3" = "Muse review" ]; then
    case "$cr" in
      success)
        muse_review_vote "$4"
        return
        ;;
      failure)
        # Muse only fails closed on an infrastructure error; never a verdict.
        printf 'abstain'
        return
        ;;
    esac
  fi
  case "$cr" in
    success|failure)
      printf '%s' "$cr"
      return
      ;;
  esac
  if [ "$cs" = "pending" ] || [ "$cr" = "pending" ]; then printf 'pending' ; return ; fi
  if [ "$cr" = "abstain" ]; then printf 'abstain' ; return ; fi
  printf 'missing'
}

workflow_for() {
  case "$1" in
    'Gemini review') printf 'gemini-code-review.yml' ;;
    'Muse review') printf 'muse-code-review.yml' ;;
  esac
}

# Can the voter's workflow still run? A disabled or deleted workflow can
# never report, so its voter abstains instead of holding the gate
# pending forever. A failed lookup is "unknown", not "disabled".
workflow_runnable() { # context -> exit 0 runnable/unknown, 1 disabled or gone
  local file out
  file="$(workflow_for "$1")"
  [ -n "$file" ] || return 0
  if out="$(gh api "repos/$REPO/actions/workflows/$file" --jq '.state' 2>&1)"; then
    [ "$out" = "active" ]
  else
    case "$out" in
      *'HTTP 404'*) return 1 ;;
      *) return 0 ;;
    esac
  fi
}
