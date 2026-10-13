# PR #3338 carryover

Compared source commit `9f5f86ca4f7949553eac7e3393aa86e85cdc32b5` with
main `e5e1c03b317b305c941b76c99d1c0015c328c9f5`.

## Retained and adapted

- Admin prize results overlay the form rather than expanding its grid row.
- Variant parents with no concrete inventory variants are not offered as prizes.
- Prize thumbnails have a local fallback and bypass the Next image optimizer.
- Topic entry has one focus indicator.
- Immediate duration is editable in seconds. Untouched test duration follows
  expected play; untouched live duration retains the shared grace policy.
  Generation resynchronizes only untouched windows to the actual question count.
- Scheduled timing retains main's Lagos-zone interpretation, clock validation,
  manual-end ownership and generation-time resynchronization.
- Production V2 starts enforce adult eligibility and live prize approval.
  Private test events do not require live-prize approval. All queries use the
  authenticated client; the existing RPC still owns attempt authorization.
- Workers can use the workspace tsx binary when the app-local executable is absent.

## Superseded, not copied

- The source PR includes the mobile ancestry of #3337. Later merged mobile work
  must not be replaced by that historical snapshot.
- Result prize claims now use `getAttemptPrizeAwardClaim` and
  `addSignedPrizeClaim` with the shared V2 result contract. The old standalone
  claim schema and duplicate route implementation are unnecessary.
- Final leaderboard counts use materialized ranking projections, including
  `20260814230000_repair_quiz_materialized_final_rankings_v2.sql`.
  Do not restore the older aggregate-count RPC.
- The historical claim/count migration is not replayed or edited.
- The old timing plan is not restored as the current specification; main's
  live timing, regulatory and publication safeguards remain authoritative.

No deployment, migration execution, prize award or quiz launch is part of this
carryover. A replacement PR is not itself proof of deployment or production QA.
