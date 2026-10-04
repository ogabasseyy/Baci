# Public staging savings draft verification

Verified 20 September 2026, approximately 20:34 UTC. This records deployed draft
flow evidence, not financial integration completion or production certification.

## Deployment

- Dedicated project: `ogabassey-piggyvest-staging`, `prj_vgV7DiXC52wOhbClB2uzjGAg9IZd`.
- Previous deployment: `dpl_7pJr1MFWx1TKYmT2kQRnfEhFFUxZ`.
- Current deployment: `dpl_GDeAL9EC4edWUL1asZrxE563GSeL`.
- Public origin: `https://staging.ogabassey.com`.
- Three exact method-scoped savings draft rewrites forward to staging-auth.
- Clean prebuilt artifact: `/private/tmp/ogabassey-piggyvest-staging-prebuilt-F2alfn`.
- Receiver SHA-1 matches the prior deployment: `c71b6e89b07b00d116e87d29d334f05f2f8881b3`.
- Function configuration SHA-1 matches: `0005e94aaa724eb52ac0d76b5631c4c9ebe007d8`.
- All 21 routing checks passed. Vercel explicitly used prebuilt artifacts; no
  source build, environment change, production Baci deployment or DNS change.
- CLI direct alias assignment refused domain access. Project promotion succeeded
  using the project's existing verified staging domains; no new domain was added.

## Live checks

The synthetic authenticated battery ran through the public staging origin, with
no spoofed forwarding headers and no logged response bodies or credentials.

- Catalogue, synthetic product and exact variant available.
- Draft creation, persisted readback and same-request idempotent replay passed.
- Policy retrieval and acceptance passed.
- Cross-merchant catalogue, list and create returned 403 with valid inputs.
- Invalid-token and unauthenticated requests returned 401.
- Webhook GET returned 200 before and after the battery. This is reachability,
  not a new signed receipt, replay, settlement or financial-ledger test.

The first battery's cross-merchant catalogue request omitted required pagination
and received 400. The corrected valid-input negative returned 403. A complete
rerun passed all 15 checks. Tests created synthetic drafts only; existing drafts
were preserved. The refresh8 synthetic session was advanced to a new private
parent-owned session file; agents must not reuse its old refresh token.

## Service and limitations

The restricted VPS service is active as `baci-savings-gateway`, `NRestarts=0`.
The absolute deadline remains **2026-09-21 11:24:05 UTC / 12:24:05 Lagos**.
No lease extension was performed. After expiry these routes are not expected to
remain available until a separately authorized bounded activation is completed.

Phone UI testing is next: confirm its existing dev build uses the staging API
and auth origins, then verify the actual screen flow. No phone test was performed
in this deployment turn. Funding, interest, cancellation/refund and financial
end-to-end validation remain separate gates. Fixed Nginx headers are not proof
that a request originated from Vercel; customer auth and tenant binding remain
required, including when the staging-auth origin is called directly.
