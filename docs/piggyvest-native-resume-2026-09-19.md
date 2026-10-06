# Existing native savings flow resumed

The owner clarified that testing must use the existing Ogabassey phone application, not the newly inspected browser surface. Native source remains in `/Users/mac/Baci-worktrees/cursor-savings-phase1`; the provider worker work remains in `/Users/mac/.codex/worktrees/0d77/Baci-app`. No wholesale copy or reset of either dirty worktree occurred.

## Running local connection

- Normal Expo router, `EXPO_PUBLIC_LOCAL_STOREFRONT=1`, `EXPO_PUBLIC_PHONE_QA=0`.
- Metro on `http://192.168.100.220:8082`, from the earlier mobile worktree.
- Capability-protected LAN relays: port 4192 to local web 4194; port 4193 to isolated Supabase 55431.
- No production credentials or provider money operations were introduced. No environment files were edited.
- Metro status and loading endpoint passed. The iOS bundle compiled with HTTP 200 (5,285 modules).
- Missing relay capability returned 403; authenticated Auth health returned 200; unauthenticated draft API returned 401.

## Authenticated native protocol test

The agent verified internal Mailpit/Inbucket delivery and used a real isolated OTP exchange through the relay (both send and verify returned 200). No forged user token or privileged customer client was used.

The native `savingsDraftSchema` validated each response for create, read and consent acceptance. The exact synthetic variant `Color: Black · Storage: 256GB` persisted. Retrying the same request returned the same draft; relisting showed exactly one matching draft with accepted consent. This proves local native transport and persistence, not physical-phone visual acceptance or provider funding.

## Hosted connection remains blocked

The public savings draft API at `staging.ogabassey.com` returns 404; working webhook intake does not mean the customer API is deployed. The current native route does not inject the separate `PiggyvestSavingsScreen` staging adapter. Existing source includes that presentation, but its presence is not a connected hosted customer journey.

The owner ran the reviewed private gateway smoke. All four source checksums passed, then the test refused at `sudo-policy`, before service startup/public activation. The installed permissions have not been weakened. A separate diagnostic lists the exact sudo cases and emits only labels, exit codes and signals; it never executes the listed helper/Node/Docker candidates. Its hash-verified owner wrapper is `/private/tmp/baci-staging-sudo-diagnostic-20260919.sh`.

Do not rerun the failed smoke blindly or claim hosted readiness. The private check must be diagnosed, then hosted customer routing and the native staging adapter must be completed and verified separately. No production deployment or external provider message occurred.

## Sudo-list diagnostic and corrected smoke

The owner's diagnostic returned 0 for syntax validation and the permitted helper; all four forbidden command forms returned 1. The three environment-assignment listing cases returned 0. The smoke incorrectly required those listing cases to return 1, although listing permission does not establish environment filtering during execution.

The corrected runner preserves all four command-denial assertions and the immutable installed-sudoers hash check. Environment listings accept only clean exits 0 or 1 and report `executionFilterProven: false`; timeouts, signals and other errors still refuse. No sudoers, service or installed runtime permission was changed. Thirty scoped regression tests passed, including a reproduction of the observed listing behavior. The corrected runner hash is `9f20a73f5bbfa5d30d74dba66d950a938c59a5fbdfbe1e4d329f998c57a6f33b`.

Fresh artifacts were staged without root at `/home/bassey/baci-isolated-savings/private-smoke-envlist.HgL4vXD9`. Parent verified all four remote hashes. The owner wrapper `/private/tmp/baci-private-smoke-envlist-HgL4vXD9-owner.sh` creates a separate sealed directory and runs the same bounded private smoke; it has not yet been executed. Public hosted access remains unverified and disabled by this workflow.

## Subsequent owner execution and current routing checks

The owner subsequently executed that wrapper: the private process started with a 60-second lease, then reported `lease-withdrawn`, `state: failed`, `socketAbsent: true`, and `restarted: false`. This supersedes the pending-execution status above. The shutdown result proves the bounded lease withdrew its socket; it is not a public activation or an environment-filter execution proof.

Fresh external checks on 19 September returned 200 for `/auth/v1/health` and 404 for the customer savings draft API. Metro still listens on 8082. Authentication reachability and the webhook-only deployment therefore must not be described as a connected hosted savings journey. The local draft handler also deliberately rejects non-loopback database runtimes: deploying that handler unchanged would not resolve hosted access.

Gateway activation preparation must preserve the existing exact `/piggyvest/intake` route and its loopback upstream, rather than replacing the vhost with an Auth-only template. A separately reviewed customer API runtime and native hosted gating remain necessary.

## Hosted wiring implementation and remaining activation gate

The backend now supports an explicitly enabled hosted draft runtime, pinned to the staging request origin, staging Auth origin, and reviewed public-key fingerprint. Both command and catalogue handlers restrict the merchant before database access. The existing mobile screen and draft client now require the independently verified hosted runtime rather than trusting a build flag alone. Parent reran 45 backend tests and 19 native tests successfully; this is local verification, not a deployed journey.

Read-only inspection of the actual isolated database confirmed the hosted draft authorization function, an enabled `hosted_draft` setting, and one enabled synthetic merchant binding already exist. The function pins database `postgres`, cluster `7685292944002592802`, and the authenticated customer relationship. Do not reapply the old migration or insert a duplicate binding.

The proposed hosted gateway identity still matches current container and network identities. However, effective Nginx workers have only group 33, whereas the gateway socket group is 984. Any owner-run activation must explicitly address and verify that narrowly scoped socket access before switching the upstream. The existing products-only smoke identity remains unchanged; hosted draft routing uses a separate identity. Working intake must remain untouched.

The customer API deployment artifact and persistent bounded gateway activation remain pending. Do not describe these local changes as deployed, and do not substitute another products-only rehearsal for application enablement.

## Reviewed hosted gateway package staged for owner execution

Parent reran 51 gateway/package/rollback tests successfully and verified the frozen package's 13 checksums locally and on the VPS. The source package is staged at `/home/bassey/baci-isolated-savings/hosted-activation.d99yic`; no privileged command was executed. The syntax-checked owner wrapper is `/private/tmp/baci-hosted-activation-d99yic-reviewed.sh`. It seals the package under `/root/baci-hosted-activation-d99yic`, verifies manifest SHA-256 `b47d0b2b7e8f6cb81bb8f0e6bb4795ade832840739450335fe2cfc24b0f7f89f`, then runs the exact hosted-draft identity with a 24-hour lease. It preserves webhook intake and refuses installed-runtime drift. Do not blindly rerun after a partial attempt; preserve the sealed receipt and inspect first.

This enables only the Auth/REST gateway prerequisites, not the absent Next customer API. The revised application deployment approach keeps the existing Vercel receiver and DNS, uses a standalone Next staging runtime, and adds only the three exact draft endpoint rewrites after private validation. The rewrite helper has two passing tests; standalone configuration is opt-in and leaves ordinary builds unchanged. Repository typechecks passed; seven lint errors outside the parent edits remain. Neither standalone app build nor deployment has occurred.
