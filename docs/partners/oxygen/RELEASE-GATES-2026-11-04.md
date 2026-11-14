# Oxygen merge and production enablement gates — 4 November 2026

This is the current follow-up tracker for [PR #3929](https://github.com/ogabasseyy/Baci/pull/3929), including review threads `PRRT_kwDOQZgfis6zJ8uA` and `PRRT_kwDOQZgfis6zbwLX`. Earlier preparation documents retain historical validation snapshots. None of the open gates below is completed by merging this document.

## Merge scope and evidence

The intended landing is a disabled production implementation. It is not approval to enable Oxygen, apply migrations, register callbacks, or perform a financial request. Keep `OXYGEN_PRODUCTION_RUNTIME_ENABLED`, `OXYGEN_PRODUCTION_AUTOMATIC_ACTIVATION_ENABLED`, `OXYGEN_PRODUCTION_DURABLE_HANDOFF_ENABLED` and `OXYGEN_CALLBACK_DRAIN_ENABLED` absent or `false` in the release configuration. Database execution, worker and general-activation policy rows must remain disabled or absent. Do not use a production configuration change to work around a failed check.

Before merge, the release maintainer must attach exact-head required CI and independent review evidence for the complete patch, address actionable findings and confirm these disabled defaults. Scoped reviews are useful evidence but do not cover the whole patch. A passing review workflow that reports exhausted quota is not a completed review. The earlier Codex review at `a11bd5e0de` does not cover later commits; review of `d0be65d3c7` was requested and its result must be checked against the final head, including subsequent fixes. Muse's exhausted allowance and unavailable local CodeRabbit authentication must be reported as review limitations, not passing reviews.

The two release findings permit a disabled landing with explicit follow-up tracking; provider host confirmation and production migration application remain enablement gates. Resolving their rollout concern requires linking this tracker and verified gate evidence. Their independent whole-patch review concern remains open until review covers the final patch or a reviewer explicitly accepts the documented disabled landing. Thread resolution alone is not review approval.

## Disabled behavior to verify

- `runtime-configuration.ts` returns no production connection unless the runtime flag is exactly `true`, even if all production credentials and hosted hosts exist. `runtime-connection.ts` also withholds callback authentication configuration behind that flag. Production never inherits staging credentials.
- A valid authenticated workflow action with no connection returns a static `503` before worker login, workflow execution or provider calls. A webhook with no connection returns `503` before ingestion or deferred reconciliation. A disabled drain returns `200 { enabled: false }` after cron authentication and performs no work; if the drain is enabled while the runtime is unavailable it returns `503`.
- `oxygen-hosted-origins.ts` returns empty production frame/camera origins while the runtime is disabled. Enabled origins require exact hostnames; selfie hosts must be a subset of hosted hosts. Browser headers additionally require an owned checkout/payment document. Neither a caller-supplied order ID nor a valid-looking route alone grants camera/frame access.
- General activation additionally needs the environment-specific automatic-activation flag and an enabled database policy. Fresh, exact-reference payment and repayment-setup evidence, durable claims and indeterminate fences still apply. Staging trial bindings do not authorize production activation. Activation does not establish merchant settlement or fulfilment.

These are local contracts. Verify the serving deployment's SHA and disabled configuration before treating a deployed copy as inert; no such deployment verification is recorded here.

## Production follow-up tracker

All rows remain OPEN. The roles below identify who must supply the evidence; no named owner assignment or external task completion is implied. The release maintainer must record the named accountable owner and evidence link for each row before enablement.

| Gate | Accountable role | Evidence required before enabling |
| --- | --- | --- |
| Exact hosted origins | Partner integration owner with Oxygen | Written confirmation of the actual production selfie, upfront-payment and repayment-setup hostnames, including any embedded checkout origin. Development examples and `payments.example.com` are not production evidence. Configure exact `HOSTED_HOSTS` and its `SELFIE_HOSTS` subset, then verify iframe CSP, camera delegation, unowned-document denial and phone handoff on the serving deployment. No hostnames are invented here. |
| Schema and capability rollout | Database/release owner | Review the target migration ledger, complete chronological replay on the supported PostgreSQL version, inspect final function definitions/grants and validate ownership/environment/activation fences. Apply append-only migrations through the approved release process and record target/version/results. Rollback-only tests do not establish production installation. |
| Separated runtime configuration | Release/security owner | Provision environment-specific restricted worker/binding, encryption, callback authentication and stable handoff origin through the secret process. Verify customer paths use RLS and restricted RPCs, and keep production policy rows/flags off until every gate is satisfied. Do not expose secret values in evidence. |
| Callback delivery and recovery | Operations owner | Register the stable authenticated receiver with Oxygen; verify actual receipt, durable idempotent ingestion and a queued synthetic event's reconciliation. Deploy the VPS five-minute schedule in `vps-workers/deploy.sh`, verify authenticated invocation against the serving SHA and test an operator alert on drain failure/oldest-pending age. The implemented 15-minute backlog `503` is an alert signal, not proof of notification. |
| Complete review and CI | Release maintainer/review owner | Final-head required checks and independent complete-patch review, with findings fixed and reviewer coverage stated. Record any accepted review limitation explicitly. Neither quota fallback badges nor an older clean SHA establish this. |
| Disabled deployment and authorized observation | Release owner/business owner | Deploy through the approved prebuilt VPS flow, verify SHA and disabled flags/policies first, then obtain explicit authorization for the controlled production purchase. Record provider payment/setup/activation evidence separately from merchant settlement, inventory, shipping and fulfilment. Enable only after all preceding evidence is complete. |
| Settlement and repayment truth | Payments owner with Oxygen | Confirm authoritative repayment-history and merchant-settlement contracts before marking scheduled instalments paid or releasing fulfilment on settlement assumptions. Activation/callback receipt is not settlement. |

The activation response shape is documented (`loan_reference`, `status: ACTIVATED`) in the previously retrieved official contract. That resolves the response-shape documentation question, not production observation or exact hosted origins. Existing production login/bank-list success is read-only authentication evidence only.

## Disable and recovery procedure

Before customer enablement, record the authorized rollback operator and verify the flag-off configuration can be deployed without changing schema or deleting evidence. To stop customer execution, disable the production runtime and automatic-activation flags; webhook and enabled drain requests will return unavailable while the runtime is off. Coordinate this with Oxygen/operations because callback delivery will not be acknowledged during that interval. Preserve queued inbox rows, command evidence and indeterminate activation claims. Do not replay uncertain financial requests, clear fences, or infer settlement from an earlier activation. Resume only after configuration and backlog health are verified.
