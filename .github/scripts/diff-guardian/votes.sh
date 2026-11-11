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
# under a "## Findings" heading, and not one Muse itself labels "unverified" (its file is not in the
# pull request, or its line is outside the diff). Bullets in the verdict, in indented finding bodies
# and in the next steps never count.
# EVERY "## Findings" heading is read, not one picked by its position: model text comes before Muse's
# own section (the verdict) and, when GitHub rejects the inline threads and the review is posted
# again, after it (the explanations), and either can contain a heading of its own. Reading them all
# means such text can only ADD a blocking vote, never hide Muse's own.
# Line endings are normalised first: a body saved with CRLF would otherwise match no heading at all.
# A fallback review ("Muse did not review") or no review at all abstains.
muse_review_vote() { # reviews-json
  printf '%s' "$1" | jq -r --arg sha "$SHA" '
    [.[] | select(.user.login == "github-actions[bot]"
      and ((.body // "") | startswith("<!-- muse-code-review sha:" + $sha + " ")))]
    | sort_by(.submitted_at) | last as $review
    | (($review.body // "") | gsub("\r"; "") | split("\n")) as $lines
    | if $review == null then "abstain"
      elif (($lines[1] // "") == "<!-- muse-fallback:v1 -->") then "abstain"
      else
        [range(0; ($lines | length)) | select($lines[.] == "## Findings")] as $starts
        | [ $starts[]
            | $lines[(. + 1):] as $rest
            | ([range(0; ($rest | length)) | select($rest[.] == "## Suggested next steps")] | first) as $stop
            | (if $stop == null then $rest else $rest[0:$stop] end)
            | any(.[]; test("^[-*][ \t]+(critical|high)[ \t]*:"; "i") and (test("unverified\\)[ \t]*$"; "i") | not))
          ]
        | if any then "failure" else "success" end
      end'
}

# A Gemini job that is red but wrote no status (a runner crash, an uncaught error) has given no
# verdict, and an outage must never block, so the red check run alone is not a vote. The review the
# job posted just before its status carries the verdict in its hidden first line (state:failure or
# state:success), so a real finding whose status write was lost still counts. No review for this
# commit is an abstention.
gemini_review_vote() { # reviews-json
  printf '%s' "$1" | jq -r --arg sha "$SHA" '
    [.[] | select(.user.login == "github-actions[bot]")
      | ((.body // "") | gsub("\r"; "") | split("\n") | .[0]) as $first
      | select($first | test("^<!-- gemini-code-review sha:" + $sha + " fp:(none|[0-9a-f]{64}) state:(success|failure) -->$"))
      | {at: .submitted_at, state: ($first | capture("state:(?<s>success|failure)") | .s)}]
    | sort_by(.at) | last
    | if . == null then "abstain" else .state end'
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
  if [ "$3" = "Gemini review" ] && [ "$cr" = "failure" ]; then
    gemini_review_vote "$4"
    return
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
