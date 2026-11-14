# Opt-in wallet PIN routing for isolated staging

`managedRouteContract('hosted-wallet-pin')` describes 30 exact REST routes:
nine existing funding routes, 16 additional already-approved wallet/savings
routes, and these five POST-only PIN RPC paths. The first 25 entries together
are the unchanged installed staging boundary:

- `/rest/v1/rpc/get_wallet_pin_state`
- `/rest/v1/rpc/set_wallet_pin`
- `/rest/v1/rpc/change_wallet_pin`
- `/rest/v1/rpc/reset_wallet_pin`
- `/rest/v1/rpc/verify_wallet_pin`

This is a route contract for the existing managed gateway and private-smoke
runner. Selecting it is explicit; existing route modes keep their old lists.
The contract grants no database permissions, starts no service and changes no
installed configuration. The regular Auth allowlist, bearer forwarding,
cookie stripping, CORS and protected Unix upstream still come from the existing
generators. JWT ownership and server-attestation checks remain authoritative in
the existing PIN RPCs.

## Prerequisites before an owner applies the candidate

1. Compare the full existing 25-route binding against the first 25 entries
   (nine funding routes plus 16 wallet/savings routes).
   Refuse unexpected drift rather than replacing another operator's routes.
2. Verify the isolated PIN migrations, enabled signing-key state, authenticated
   RPC grants and negative ownership/attestation regressions. Configure a
   separate staging pepper and approved staging rate limiter. Do not borrow
   production limiter credentials or disable the fail-closed limit.
3. Review and preserve the current binding's absolute `leaseExpiresAt`, runtime
   identity, configuration hashes and root-owned rollback evidence. Do not run
   the seven-day renewal script to add routes or extend an existing deadline.
   If installed source hashes differ from this checkout, review that difference
   and preserve operator changes; this contract is not an installer and does
   not authorize overwriting the running daemon or its import closure.
4. During an approved staging maintenance operation, stop the existing gateway
   and archive its binding and startup evidence under root ownership. The
   existing smoke runner requires stopped/absent state and refuses collisions;
   it is not a hot-update or automatic restart mechanism.
5. Use `runPrivateSmoke` with the reviewed 30-route identity, explicit
   `routeContract: 'hosted-wallet-pin'`, `retainOnReady: true`, and
   `leaseExpiresAt` equal to the previously approved absolute deadline.
   Its existing actions must freshly verify firewall rules, Auth/REST
   reachability, Docker identity and health before creating startup evidence.
   Never retimestamp a receipt or reuse a receipt covering a different route
   set. The mode refuses a missing absolute deadline before host actions.
6. Use the existing managed public-ingress generator for that same binding and
   fresh startup evidence; review the candidate, check nginx configuration and
   apply it through the normal owner procedure. Keep public ingress failing
   closed until the private socket and intended service invocation are ready.

## Acceptance and rollback

Check all five exact RPC paths with isolated synthetic requests: unauthenticated
access is denied, unsupported methods are denied, valid authenticated requests
remain bound to the signed-in customer, and invalid attestations are refused.
Recheck unknown/admin/signup denials, browser CORS and generic error handling.
Then test PIN set/status/verify and the wallet-to-savings flow through the app
using only the approved QA identity. Do not use or mutate the recording account.

If activation fails, stop the owned gateway invocation so its Unix listener
withdraws. Preserve failed evidence. Restore only reviewed prior configuration
with a still-valid lease and genuinely fresh startup evidence for that prior
identity. An expired receipt is not a working rollback and must not be altered.
This staging operation never enables production payments or capture replay.
