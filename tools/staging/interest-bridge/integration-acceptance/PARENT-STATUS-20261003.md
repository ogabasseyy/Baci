# Parent staging status — 2026-10-03

This report separates reviewed source, deployed execution, provider evidence and
customer credit. It is not a production or final integration acceptance claim.

## Corrected root cause

The paid-interest-only claimant, not the corrected native replay factory, consumed
the signed outflow receipt's fifth attempt. It lacked native outflow capability.
The parent stopped that competing service without changing receipt state, backoff,
claims, financial rows, budgets, original files or the fixed deadline.

The corrected native claimant remains running. The existing receipt's natural
retry remains `2026-10-03T07:45:26.302325Z`; do not accelerate or reset it.

## Reviewed replacement, prepared but inactive

The paired replacement preserves the corrected native factory and its private
configuration and adds a separately restricted paid-interest executor. Both
executors passed the actual compiled nonclaiming `--check` on the VPS. Independent
before/after checks prove unchanged protected financial state, both goal
principals and complete receipt/quarantine/signature table hashes.

- Generation: `/opt/baci-prefunded-replay-generations/complete-9r5r9u8z`.
- Generation seal: `69585e50cb88aeac5e0660ed235b39f6ac6d675b35cf9acabd32cd2945d695ba`.
- Private audit: `/root/baci-complete-replay-owner.ej9w9hde/preparation-result.json`.
- Daemon: `20a14582973e49d77f13140854107d386586364c8831a23e203b1967e7223126`.
- Source closure: `380150f411cba2c96b57e1ef48607a7b71eafb60bb9def5bc48f80acceb3931b`.
- Fence not applied; replacement not started; no additional payment initiated.
- Original Oct6 deadline remains active and unchanged.

The upload initially had mode0640; it was tightened to0600. The protected-read
check was not weakened. Optimized Python execution refuses before any root/config
reads, and refusal diagnostics expose only static source locations/error types.

## Validation boundaries

The exact configured-runner suites pass: 158 tests. New owner preparation helpers
pass44 tests; the claim-fence suite passes23, including14 real disposable PG17
checks. Scoped TypeScript and18 owned-file Biome checks pass. Broad typecheck passes.

Broad lint has32 errors/four warnings in older staging files. Broad tests have
19 failures in16 web suites; 35,677 web tests pass. Shared, mobile-admin and
mobile-storefront suites pass. These broad failures are not a clean full-repo gate.
CodeRabbit completed the new fence and owner reviews with no high findings; the
larger compositor review refused its263-file input limit. Independent parent and
agent review is recorded separately, not represented as completed CodeRabbit.

## Remaining gates

1. Observe the original signed receipt's natural retry and exact native evidence.
2. Reconcile the existing successful transfer and prove exactly one app credit,
   preserving the original plan and total10000-kobo company allowance.
3. After that proof, rehearse and commit the separately reviewed claimant fence,
   prove actual authenticated old/new token behavior, and exclusively start the
   sealed paired generation. Never restore unfenced SQL or old claimants.
4. Confirm authenticated wallet/goal/inbox readbacks and restore safe schedules.
5. Distinguish synthetic paid-interest contract coverage from genuine provider
   payout delivery, which PiggyVest says cannot be triggered in sandbox.
6. Keep physical-phone/signing/push acceptance explicit and unverified.

Daily accrual observation is absent from this paired configuration. Such events
remain retryable, not credited or falsely marked processed. Monthly paid-interest
allocation does not depend on summing daily observations. A sustained queue-health
solution for disabled accrual requires separate restricted review; do not broaden
the paid-interest role or start another competing claimant.
