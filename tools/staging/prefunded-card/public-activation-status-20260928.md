# First-card checkout: staging deployed; physical payment test pending

## Current verified state — 28 September 2026

The owner ran r2 and received `FIRST_CARD_PUBLIC_STAGING_ACTIVE`. Independent
checks confirm the restricted service and unchanged deadline timer are active.
Gateway and funding remain active; background and snapshot last runs exited0
with their timers waiting. The only returned customer goal is
`430314fd-cd8b-4579-98d4-e9f345713dd6`, active with its original **₦100**.

The dedicated staging Vercel project was deployed with `--prebuilt --prod`:
`dpl_GNQ2FjqiAKx8HEBbE5oS8ZBFwARj`, aliased to `staging.ogabassey.com`.
Here `prod` selects the dedicated staging project's primary alias, not the Baci
commerce production project. Its predecessor was
`dpl_7qPRHtyJuMbQe2Zfw4y4rfFeQ394`. Config and webhook artifact hashes below are
unchanged from review; the CLI confirmed it used the prebuilt output.

Verified through the phone origin:

- Authenticated checkout capability: HTTP200, enabled, maximum10,000kobo,
  exact enrolled goal, `no-store`. Original goal principal remains₦100.
- Invalid authenticated POST/PATCH bodies:400, duplicate query:400,
  foreign Origin:403, unowned goal:503 without exposing another customer's data.
- Checkout unauthenticated GET/POST/PATCH:401, wrong method:405; saved-card
  contributions remain404. Callback GET/HEAD and all six assets:200.
- CSRF bootstrap:200 with secure host-scoped cookie; values never printed.
  Wallet/goals/drafts baseline remains401; webhook health GET remains200.
- Proxy regression suites:18 tests pass. No valid checkout start, card charge,
  financial reservation or provider transfer was requested during verification.

Metro was stopped and is now running from `cursor-savings-phase1` on LAN8082
(`192.168.100.84` at verification). The process uses an allowlisted development
environment with dotenv disabled and both hosted/test-payment flags enabled.
The legacy phone-env anon key differs from the build pin, so the launcher used
the existing `hosted-public-client-profile.json` public key after exact hash,
origin/issuer/merchant checks and a live anonymous merchant read. No pin or
credential file changed; login credentials were not passed into Metro.

The manifest has the exact staging origins and key hash. A complete iOS bundle
build passed (27,307,125 bytes, SHA256
`638b8f1b1f089fd4571fb5950b7a253d84e164848bea62e346eaa85688517726`). It contains
the new-card interface, checkout action, mutation guard and exact enabled flag
values in Expo's virtual-environment property descriptors. Initial diagnostic
patterns assumed inline values/assignments and were corrected; no app change was
needed. Physical-device loading, checkout completion and provider credit are
still user-test gates, not outcomes of these HTTP/bundle checks.

Phone test: reload the staging development app on the same Wi-Fi, open the
existing plan, choose **Use a new card**, enter **100**, review and continue to
secure **test** checkout. Do not exceed the approved₦100 test budget. Use
**Refresh status** after returning; a callback or pending state is not proof of
a completed savings contribution. The fixed deadline is **29 September, 4:59 PM
WAT**. Saved-card debits remain unexposed.

## Owner command — completed; do not rerun

Run on the Mac, not from the VPS shell:

```sh
/bin/sh /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/activation-public.sh
```

The command connects to the VPS and requests sudo. It first copies and verifies
the sealed runner and all 17 payload files in a new root-only audit directory.
It then checks the Nginx predecessor and existing routes before installing any
service, projects only checkout and anon configuration, proves both restricted
database connections, arms the unchanged deadline, starts loopback HTTP, and
installs/probes the exact staging Nginx routes. Expected final marker:
`FIRST_CARD_PUBLIC_STAGING_ACTIVE`. No financial request is made by the installer.

Do not run another Nginx editor/reloader concurrently. The installer rechecks
bytes and inode metadata immediately before atomic replacement, including on
rollback; this is not an atomic compare-and-swap against an uncooperative root
writer. Failure withdraws only this new public service, not financial recovery,
signed replay, snapshot or background workers. Preserve the root audit output.

## Frozen scope and pins

- Deadline: **29 September 2026, 15:59:10 UTC**; no renewal implied.
- Preserved existing principal: **10,000 kobo**. Separate approved company test
  budget: **10,000 kobo**. Saved-card contributions remain disabled/unexposed.
- Database physical identity: `7685292944002592802`.
- VPS payload: `/home/bassey/baci-public-checkout-20260928-r2`.
- Runner SHA256: `7e4b7741da65a10320bc2d991f7136affede1de6edf773b1177eb63cd12724d9`.
- Checksum-list SHA256: `4661478deb30a903f9281c4f23aa3005ba6cee6239c7083f3a7e8f438766d2e6`.
- App tarball SHA256: `63431f68c320bf40a5d10136fb9f748ce8aa51f349a829534740bb25f4b94f6f`.
- App manifest SHA256: `525902e94dca498fe1d5a66c4be53b10335a7f663e07f62203c8f7fd81f77c82`.

All staged VPS hashes and the isolated Python import closure were checked. No
root installer was executed by the agent: noninteractive sudo still requires
the owner's password. No production configuration or payment was changed.

## Nginx preflight refusal and r2 correction

The owner's first attempt verified its bundle but refused at `nginx-preflight`.
Read-only checks at 06:10 UTC confirmed the public app directory was absent,
gateway and funding services remained active, and auth/wallet/goals/drafts still
returned JSON401 while intake GET returned405. The live vhost is root-owned
0400, 9,469 bytes; its enabled symlink and parent metadata match the contract.
Its contents and original root exception remain unavailable without owner sudo.

A compatibility defect was reproduced against the earlier managed gateway
renderer: this new installer required the root location to return404/503,
whereas our earlier installer intentionally created a restricted Unix-socket
gateway root. R2 accepts only its exact eight-directive shape and requires the
existing exact named503 fallback. It preserves every predecessor byte. Foreign
upstreams, includes, missing guards and root modifiers still refuse; Luna review
found the modifier bypass and a red/green regression now covers all six cases.
A historical readable vhost transformed using the actual managed renderer also
passes; this is a historical-derived fixture, not the current live vhost.

Refusals now report a closed literal `reasonCode` and exception category, never
raw messages. HTTP baseline failures have a separate stage. This will identify
any additional live mismatch instead of another ambiguous preflight refusal.
No gate, deadline, database authority, payment state or app artifact changed.

R2 validation: 102 focused Python tests, 14 Node tests, scoped Biome and full
monorepo typechecks pass. Full lint remains blocked by 11 unrelated mobile
errors. A scoped CodeRabbit attempt skipped the untracked files as "no
uncommitted changes"; this is not approval. Independent Luna review passed the
corrected transform. All 17 remote payload hashes, isolated imports and shell
syntax pass. The r1 audit bundle is retained; r2 is staged, not executed.

## Previous artifact verification retained

- Existing workers remain successful; funding and gateway active. Read-only DB
  preflight verifies functions/roles/scope, original principal and zero operations
  and checkout intents. Existing public auth, wallet, goals and drafts return
  JSON401; intake GET returns405.
- Dedicated minimal Next standalone build passes. Final artifact has 3,477 files,
  no synthetic build anon value, only checkout/CSRF/callback routes and assets.
- Exact packaged launcher runs in the pinned image as UID65530, read-only,
  cap-drop-all, no-new-privileges, **network none**, using synthetic configuration.
  Ten HTTP/method checks and six unique callback assets pass. `--check` correctly
  refuses without its database; real restricted TLS is an owner-install gate.
- 89 focused Python installer/contract tests and 14 Node build/bootstrap/bundle
  tests pass. The final auth/environment/readiness/executor slice passes 112
  tests; the broader earlier prefunded/checkout slice passes 889 tests.
- Luna fixed the mobile request guard that rejected first-card POST/PATCH. Its
  seven focused suites pass 140 tests. Strict staging origins and the existing
  `EXPO_PUBLIC_STAGING_TEST_PAYMENTS=1` gate remain required. No flags, `.env`
  values, installed client or Metro process were changed.
- Parent and independent Luna/Terra review addressed the missing bundle import,
  exact named Nginx fallback preservation and the demonstrated temporary-write
  concurrency gap, with red/green regressions.
- Full typechecks pass; scoped Biome passes. Full repository lint still fails on
  unrelated existing files. CodeRabbit refuses the dirty tree at 211 files
  against its 150-file limit despite `--dir`; no CodeRabbit approval or full
  monorepo-test pass is claimed.

## Original post-owner checklist — deployment gates now completed above

1. Independently verify service, deadline, original balances and staging Nginx.
2. Recheck Vercel alias and baseline before deploying the prepared prebuilt proxy
   at `/private/tmp/baci-first-card-proxy-20260928`. This is only project
   `ogabassey-piggyvest-staging` (`prj_vgV7DiXC52wOhbClB2uzjGAg9IZd`).
   Its config has 28 rows, SHA256
   `55b9f9de9fcf54703f06b705452712fffc6d29adccebd019be4ddd7214fa087b`.
   Webhook function and runtime metadata are byte-identical to the predecessor.
   **This proxy was subsequently deployed as recorded above.** Never use the canonical production
   `.vercel/project.json` for this release.
3. Verify authenticated capability, CSRF, callback assets and pending-state
   behavior through `staging.ogabassey.com`, then verify actual Metro flags and
   reload the phone bundle. Do not declare phone readiness prematurely.
4. The owner's bounded card checkout still must prove collection, company-wallet
   transfer, original signed receipt, exactly-once recognition and phone balance.
   Neither a callback nor a successful empty worker pass proves savings funding.
