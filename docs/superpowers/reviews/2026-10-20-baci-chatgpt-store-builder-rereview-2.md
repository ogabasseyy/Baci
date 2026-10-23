# Baci ChatGPT Store Builder — Second Plan Rereview

**Date:** 20 October 2026

**Scope:** Manual rereview of the corrected plan/design against repository baseline `270fe355d8a78ddb685e3e490fcf6652fe89910e`, with fresh Supabase OAuth/session documentation. This pass checks implementability of authority, provisioning and public-version boundaries; it does not repeat the first review as new findings.

**Disposition:** Six additional design gaps are corrected in the [plan](../plans/2026-10-20-baci-chatgpt-store-builder.md) and [design](../specs/2026-10-20-baci-chatgpt-store-builder.md). No further concrete blocking omission was identified in this pass. Runtime/provider/transaction proofs are still required before the corresponding feature slices can pass.

## New findings

| ID | Priority | Gap and consequence | Correction / required proof |
| --- | --- | --- | --- |
| R12 | P1 | The plan introduced a vault without defining how it obtains an independently renewable upstream user session. Copying a normal website refresh token would make browser and broker rotation/revocation race; a broker-only lock does not coordinate the browser. | Tasks 1/3 now require a dedicated server-side broker→Supabase OAuth code/PKCE grant, distinct inner/outer transaction state and subject validation. Prove independent refresh/disconnect for browser and two connections. No browser-token capture or admin minting fallback. This remains a GO/NO-GO test, not an asserted current capability. |
| R13 | P1 | Supersession required a newer plugin receipt, although native Baci publication creates none. The proposed marker also needed coverage of all published-state writers; otherwise later native content could still carry the old receipt's version and be falsely verified. | Separate `DraftVersion` from database-maintained `PublishedVersion`. All effective native/browser published-state changes advance the public version. Publish results accept supersession by a current version with an optional newer receipt. Public config/version must be selected as one coherent DTO, including the client Puck path. Task 8 covers publish/unpublish races and already-live receipts overtaken later. |
| R14 | P1 | “Recheck live grant” did not define the authoritative row or transactional relation to revoke. Request-entry checks, a mirrored active-state table or a pre-generation check can allow an old context to mutate after revocation/version change. | One canonical non-secret authorization row is shared by OAuth revoke/reuse, Baci disconnect and business RPC checks. Normal RPCs lock/read it under explicit RLS/invoker grants; private provider roles get auth-metadata access only, never commerce access. Create/queue/claim/completion/apply/intent/confirm/replay checks serialize with revocation. Tests also prove the trigger/legacy lock graph, not just a stated lock order. |
| R15 | P1 | Atomic draft creation omitted canonical `domains` provisioning. Existing onboarding explicitly reserves `${slug}.${rootDomain}`; a merchant/page row alone does not prove its proposed website address resolves. | Task 4 includes canonical subdomain reservation, ownership/collision checks, primary-domain preservation and rollback in the same create/bind transaction. Staging must resolve the canonical host while keeping the draft unpublished. No paid DNS/domain operation or foreign-tenant takeover is added. |
| R16 | P1 | Existing stores were accepted without proving that their actual template consumes the edited config. `StorefrontWrapper` can select a registry template instead of Puck, so a successful config update could leave the public site unchanged. | V1 creates explicit Puck stores. Status reports consumer capabilities; unsupported/custom templates fail closed with a Baci editor link and cannot queue/apply/publish through these tools. Do not silently migrate templates or claim an unused config is a site edit. Task 0 proves the consumer/renderer path, Tasks 2/5/7/8 enforce it. |
| R17 | P2 | The plan referred to reuse of Muse's approval verifier without reconciling its numeric `resourceVersion` and fixed connector policy version with the builder's opaque draft string. A cast or shared policy could bind the wrong effect. | Task 2 defines `BuilderPublishIntent`/`verifyBuilderPublishIntent`, exact string revision equality and policy namespace `baci.website-builder`; Task 8 uses it plus DB nonce/effect enforcement. Only generic canonical hashing is shared. Muse behavior/tests remain unchanged. |

## Evidence inspected

- `apps/web/src/app/(platform)/onboarding/ensure-onboarding-domain.ts`: domain ownership, canonical subdomain insertion, primary selection and collision handling.
- `apps/web/src/app/(storefront)/[slug]/storefront-wrapper.tsx`: explicit Puck selection versus named/business-type registry templates.
- `apps/web/src/components/storefront/puck-storefront.tsx`: client-side `published_config` selection and rendering, with no current plugin receipt/public-version contract.
- `apps/web/src/app/api/builder/builder-draft-mutations.ts` and `apps/web/src/app/api/merchant/publish/route.ts`: native publication paths independent of new plugin receipts.
- `apps/web/src/lib/connector/approval-proof.ts`: numeric resource version and connector-specific policy coupling.
- [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows): server-side code/PKCE and refresh flow; a new upstream broker client/configuration needs a tested contract.
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions): refresh-token reuse and session behavior; no assumption that a copied session is independently revocable.

## Gates still open

- Actual proof that the chosen upstream/provider combination issues independent, renewable and independently revocable grants with the required resource/scope behavior.
- Editor-free preview/public-consumer proof and actual runtime/cache execution.
- Disposable-database RLS/grant/lock, domain collision and atomic version/receipt tests.
- Real ChatGPT staging connection and complete new/existing-store journeys.

These are deliberate implementation acceptance gates. Do not mark them passed because the documents are internally consistent.

## Review and validation boundary

Only plan/spec/review documents changed. Both existing submissions remain untouched. No application code, migrations, environment, live database, deployment, tool refresh or submission operation was performed. Verification for this rereview is document consistency/link/whitespace checking and source/document inspection; no provider/host/application test result is claimed.

Input fingerprints before this round:

```text
plan   d1585a90dce2a9307c1615f090a496946a8f36c07fe378546d3a49dfe3276846
design 73e37e188d8efc82031a419627afe40999ff8622a7d9097381cc7a0d69ca0538
```
