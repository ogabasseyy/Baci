# PiggyVest live preparation evidence

Date: 23 October 2026. Candidate only; no deployment or activation.

## Baseline

- Fresh Vercel production metadata: deployment `dpl_S8ywd9En9z22gkZEyKVaMX9Hz8KP`, revision `6e0d7083a5ac40a65464c2d3d0cf122e6d9de28c`.
- Candidate checkout is based on that revision. The dirty historical checkouts were preserved.
- VPS root filesystem: 13 GB available, 94% used at inspection. No cleanup performed in this implementation session.
- Existing sandbox app and intake containers were running at inspection. No service configuration changed.

## Database evidence

Read-only metadata and aggregate queries used the connected Baci project `aivqthbxdshhltbwipbr`. No financial records were fetched or modified.

- Migration versions `20261007220101`, `20261007230000`, `20261007230200`, `20261008093600`, `20261008094900` are recorded as applied.
- Existing `piggyvest_primary.bank_signed_inbox`, bank conflicts/authorities, paid-interest inbox/conflicts/observations, and existing savings-ledger relations have RLS enabled.
- Group roles `primary_bank_signed_intake` and `primary_bank_inbox_worker` exist, are NOLOGIN, nonsuperuser and do not bypass RLS.
- Exact login roles `baci_primary_bank_intake`, `baci_primary_bank_worker` and `baci_piggyvest_primary_evidence` were absent from the role query.
- Aggregate queries of `piggyvest_primary.integrations` and `piggyvest_primary.bank_inbox_authorities` returned no rows.

Conclusion: reuse the existing database contracts. Production is not provisioned for these runtimes. Applied migration history alone does not establish usable permissions, installed schedules or a configured production integration.

## Candidate code

`live-webhook-relay.ts` implements bounded, raw-byte forwarding using explicit configuration. It has no environment reader, route importer or automatic activation. Configuration rejects nonproduction scope, credential-bearing URLs, query/fragment URLs, wrong paths and malformed tokens. The authenticated upstream acknowledgement must match integration and body digest. Response bodies are bounded and aborted on cleanup; errors never return upstream contents or credentials.

Tests use fake fetch, signing strings and local streams only. No live provider fixture writes or production database writes are used. This helper does not implement receiver durability, provide a production hostname, or migrate customer routes.

## Provider and documentation checks

The official authentication, wallet-list and webhook-signature documentation was inspected. Live verification used only GET `/api/v1/wallet/api/wallet-type?limit=1`, with the saved secret read in memory on the VPS. No key or provider payload was printed.

The first request returned 403. A bounded diagnostic using an explicit preflight User-Agent returned 200; a final bounded request returned HTTP 200, provider `status: true` and the documented wallet-list shape. Egress matched the previously whitelisted VPS address. The initial difference is unexplained; do not attribute it to the User-Agent without further evidence. Reproduce with the eventual Node runtime and verify the owner-confirmed business before cutover. No whitelist change was made.

## Remaining gates

### Read-only production permissions follow-up

Production-derived permissions-only clone follow-up: `piggyvest-production-acl-rehearsal-20261023.md` records the pinned 1,200-target manifest, 40,161 checked PUBLIC-derived privilege comparisons, 3,214 retained explicit ACL entries, and seven passing local SQL tests. Production remains blocked by 203 managed-owner routines that postgres cannot regrant; nothing was deployed or activated.

Follow-up local implementation: see `piggyvest-primary-permissions-local-repair.md`. The explicit-manifest compatibility candidate and six SQL regression tests pass locally; no production grants, logins or authorities were changed. Production inventory/clone rehearsal remains a separate gate.

Fresh catalog inspection on 23 October confirmed both bank capability groups remain NOLOGIN, nonsuperuser, without BYPASSRLS, CREATEROLE, CREATEDB or replication. Only postgres is currently a member of these groups; the three proposed application logins remain absent. Integration and bank authority counts remain zero. No production writes were performed.

Both groups inherit unexpected EXECUTE eligibility, including 131 public-schema and 10 net-schema functions with schema USAGE, plus extension/private-schema functions without schema USAGE. Each also inherits privileges on 10 non-catalog relations. ACL inspection attributes those relation grants to PUBLIC: cron/extension objects lack schema USAGE, but net.http_request_queue, net._http_response and their queue sequence are schema-accessible. No queue contents were read and no function was invoked.

The deployed bank_role_safe predicate rejects any non-catalog relation privilege or function EXECUTE eligibility outside its exact allowlist, even when schema USAGE is absent. Consequently, simply provisioning the proposed logins with these memberships will not produce a ready bank runtime. This is a production compatibility blocker, not evidence of money movement or an exploit through an installed application login.

Do not broadly revoke PUBLIC grants or weaken the predicate to make readiness green. PostgreSQL role-specific REVOKE cannot subtract privileges inherited from PUBLIC. Prepare an independently reviewed, append-only compatibility change with an explicit inventory of affected application/extension consumers, positive least-privilege grants, and local regression coverage for PUBLIC-inherited function, relation and sequence privileges. Preserve denial of schema-accessible net operations and all existing financial/idempotency checks. Until that change is tested and separately approved for deployment, leave login provisioning and authorities unconfigured.

1. Refresh the verified live credential/business and production merchant binding before cutover; see the disabled binding candidate.
2. Provision reviewed restricted login roles and integration authorities through the established mechanism; no service-role shortcut.
3. Finish the egress matrix, including raw fetch clients and tooling outside the standard client graph.
4. Implement the matching VPS adapter around existing stores and family dispatch, then test durable acceptance/replay in isolated storage.
5. Review installation capacity, root access, worker scheduling, backup recovery and cutover separately. No public hostname, deployment or provider webhook change is authorized by this evidence file.
6. Validate actual production login grants before provisioning. The local SQL replay blockers described below are fixed; fixture grants are not evidence that production credentials or authority bindings are installed correctly.

## Validation of this candidate slice

- Focused relay/schema and existing bank/interest intake/worker tests: 71 passed across five files.
- `pnpm turbo lint`: passed, six existing warnings outside this slice.
- `pnpm turbo typecheck`: passed after correcting abort-listener typing.
- Independent review: connection cleanup issue fixed with three failing-then-passing regressions; final scoped review found no further concrete issues.
- CodeRabbit: two findings, listener typing and malformed-URL exception. Both corrected; malformed-URL regressions failed before the fix and passed afterward. The final independent review inspected both corrections.
- Full `pnpm turbo test` completed. Shared, mobile-admin and mobile-storefront suites passed; the web run had the three failures explained below, so the full repository gate is not green.
- Follow-up: the full run finished with 8,502 web files passing, 68 skipped and three failed. The failures were: a malformed-URL test loaded before its fix; the repository authority check requiring a colocated limits test; and the Cloudflare isolation test rejecting a dirty checkout. The URL test and authority check pass on focused rerun after fixes. The clean-checkout test remains an explicit validation limitation while these changes are uncommitted; no bypass or commit was used to conceal it.
- Added an explicit VPS production-host predicate to the two existing paid-interest runtimes. Regression tests first reproduced their Vercel-only rejection; 53 host/runtime/key-union/worker tests pass after adaptation. Existing Vercel behavior and scoped runtime schema validation remain enforced.
- Combined relay, host, signing-key union, bank and paid-interest tests: 111 passed across ten files. The repository authority test passed after adding the payload-compatibility test for the relay limits. Tests validate that the maximum relay payload fits the existing bank inbox contract.
- The first explicitly enabled SQL replay run failed before its accounting assertions. Fixture-only corrections resolved the blockers: the bank setup now revokes inherited PUBLIC execution on card helper functions; the notification setup reuses the inherited title column, preserves its required default/non-null behavior and uses a noncolliding goal ID; production-interest setup reuses the inherited auth schema with the intended claim-based fixture function. No migration or production privilege predicate changed.
- Final explicit SQL run: bank inbox, production paid-interest inbox and completion-notification integration tests all passed (three files, three tests). Every test used its own fresh local Unix-socket-only PostgreSQL instance and teardown. Existing duplicate-credit, replay, reversal and privilege-escalation assertions remain active. No production database, role, balance or activation setting changed.
- A read-only metadata query confirmed the production bank group inherits EXECUTE eligibility on functions outside its allowlist through existing grants. This is relevant to its strict capability predicate, but does not establish an exploit: schema USAGE, login membership and callable behavior require further analysis. Do not broadly revoke PUBLIC privileges across the application or alter the guard without an independently reviewed compatibility fix.
- Signed-in provider settings confirmed Ogabassey Services Limited and displayed ID `01KANDA76ZVWQXDMJ8N507TW8F`. Both stored credentials matched the dashboard's masked endings. A subsequent authenticated production wallet-list GET returned at least one business ID, with every observed ID matching the dashboard. Only booleans were printed; no wallet details or keys were exposed. The disabled binding candidate records the observed production merchant ID separately from the sandbox fixture ID.
- Current changes are staged in the task-owned checkout, with no commit or push. The relay remains unwired, so installing this code alone cannot activate financial processing.
