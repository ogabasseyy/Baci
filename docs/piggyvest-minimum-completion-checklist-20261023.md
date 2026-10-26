# PiggyVest: minimum completion checklist

Scope reset: reuse the existing integration. No new ledger, projection system, handoff implementation or payment activation is authorized by this audit. The larger isolated-ledger design is parked, not the default next task.

## What exists and can be reused

- Existing VPS sandbox application, isolated Auth/REST/database, durable webhook intake, bank worker and notification timer configurations.
- Fresh read-only inspection of the existing isolated application database confirmed system ID `7685292944002592802` and the installed bank-role guard, savings reservation and paid-interest contracts. We are not starting from an empty financial database.
- Existing onboarding, provider-wallet mapping/provisioning, contribution reservation/dispatch/reconciliation, interest handling and duplicate protection. The audit inspected their current source contracts; installed function presence alone does not prove correct behavior.
- Earlier local validation: seven SQL integration tests plus eleven ledger-authority tests passed. This audit did not send provider transactions or rerun the phone flow.
- Existing saved-live-key/business-binding evidence and bounded relay candidate remain available. Earlier successful read-only provider evidence is not a fresh key-health or deployment check.

## Fresh operational findings

| Check | Result |
| --- | --- |
| Existing sandbox app and isolated Auth/REST/database containers | Running; database healthy |
| Durable receipt intake/database containers | Running |
| Bank and notification timers | Scheduled, but both services report last Result=exit-code and ExecMainStatus=1 |
| Staging Auth health, settings and unauthenticated user endpoints | HTTP 503 |
| Unauthenticated staging customer wallet endpoint | HTTP 401, expected denial; not authenticated flow proof |
| Staging primary-transfer GET probe | HTTP 405; does not prove recovery readiness or absence of its deployed route |
| VPS root filesystem | 97% used, 7.5 GB available; no cleanup performed |
| Existing bank/notification deadline timers | 26 October 2026, 21:38:07 UTC; not renewed |

These are operational blockers in the existing sandbox, not a justification to rebuild the integration. Container uptime and scheduled timers must not be described as a successful working financial flow.

## Four completion steps

1. **Restore the existing sandbox.** Diagnose Auth 503 and the two failed worker services; verify the current guarded routing, dependencies, database session readiness and resource pressure. Change only the identified fault, preserve the lease/security boundary, recording account and existing data. Do not silently extend access or clean unrelated disk contents.
2. **Prove one complete existing-code sandbox flow.** Use a separately approved disposable test identity: account creation -> sandbox bank funding -> genuine durable webhook -> one wallet credit -> contribution -> one savings settlement -> paid-interest attribution/notification. Re-deliver/retry exact identities and confirm no duplicate effect. Inspect provider, receipt, wallet and plan evidence separately. The fresh recording account stays untouched. No provider deposit or financial action was performed during this audit.
3. **Pin the smallest production configuration/routing gap.** Verify production customer Auth/ownership, authoritative wallet/goal storage, fixed VPS API egress, webhook destination/signature mapping, recovery and worker roles against the existing working deployment. State every necessary code/config delta before implementation. Do not assume sandbox credentials, fixtures, Auth users or balances can simply be promoted. Do not retry the unsupported hosted managed-permission rewrite. If a real identity/storage gap requires architecture work, present that exact gap rather than silently adopting the parked outbox design.
4. **Separate production approval from preparation.** Prepare reviewed, disabled configuration plus rollback/recovery checks. Only after explicit live-activation approval perform any production enrollment, account creation or payment test. Read-only provider success and passing local tests do not authorize real-money operations.

Immediate next work is step 1, not writing another integration. No new architecture code, account/financial mutations, service restarts, deployment or activation occurred in this audit.
