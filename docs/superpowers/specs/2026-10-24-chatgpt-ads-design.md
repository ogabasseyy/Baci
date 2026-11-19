# ChatGPT Ads integration for Baci and Ogabassey

Status: design approved in chat; implementation is local and unshipped.
Ads Manager source and conversion creation are complete. User approved accepting
Conversion Terms for that source. User subsequently required Baci's defined
server event delivery pipeline and confirmed the merchant self-service flow.
The implementation therefore adds a dedicated durable ChatGPT destination and
uses the browser Pixel for consented activity, with no browser payment authority
and no legacy direct CAPI fanout.

## Outcome

Add a ChatGPT Ads entry beside Facebook and TikTok at
`/dashboard/integrations`, opening `/dashboard/integrations/chatgpt-ads`. Merchants
configure their own Pixel ID and server key. Ogabassey is the first configured
merchant. The primary conversion is a server-confirmed fully paid order.

## Approaches

1. Extend the existing merchant integrations, browser Pixel provider, and paid
   conversion destinations. Recommended: consistent tenant configuration and
   reuse of the established durable payment event pipeline.
2. Hardcode an Ogabassey-only snippet and webhook call. Faster initial setup but
   creates a separate settings, retry, and consent path. Does not satisfy the
   requested reusable Baci integration.
3. Tag-manager installation only. Handles browser events but does not provide
   payment-authoritative server delivery. Insufficient for the requested CAPI.

The user approved extending the existing integrations and confirmed the self-service setup path.

## Existing implementation evidence

- Facebook setup: `apps/web/src/app/dashboard/integrations/facebook/page.tsx`.
- Shared form and saving: `TrackingPixelSection` and `useIntegrationSettings`.
- Existing features endpoint authenticates, resolves merchant access, applies
  growth plan gates, validates input, and uses the normal Supabase client.
- Browser mounting: `AnalyticsPixelProvider` and
  `buildMerchantAnalyticsSettings`.
- Server configuration: `fetchAnalyticsPlatformConfig`, feature-setting
  precedence, and `hasConfiguredAnalyticsPlatform`.
- Legacy paid fanout: `triggerPurchaseConversion` → `sendPurchaseConversion`.
- Durable paid route: `analytics.purchase.completed.v1` →
  `loadPaidOrderDeliveryEvent` → `deliverAnalyticsEvent`.
- `loadPaidOrderDeliveryEvent` explicitly reloads an order scoped by merchant
  and rejects payment statuses other than `paid`.
- Browser payment completion: Ogabassey's
  `checkout/capture-checkout-payment-completed.ts` is a useful existing signal,
  but each caller must be checked for authoritative payment confirmation and
  correct deduplication identity before adding a Pixel conversion there.
- Anonymous storefront snapshots and `toTemplateMerchantData` use independent
  allowlists. Both must expose the new public Pixel ID, and neither may expose
  the CAPI key.
- Durable destinations have application unions, validation schemas, active
  destination configuration, and a database destination CHECK constraint.
  Updating only the provider fanout will not enable durable delivery.

## Merchant setup contract

- Reuse the existing dashboard card and form styling, with labels **Pixel ID**
  and **Conversions API key** and an illustrated setup guide.
- Show separate states: not configured, Pixel configured, server key configured,
  and event verification pending. Configuration alone must not claim live
  tracking or successful delivery.
- Public Pixel ID and private CAPI credential are distinct persisted fields.
  Prefer the existing merchant feature settings ownership model; use a new
  append-only migration and inspect its real RLS and column grants first.
- Keep credential input write-only. GET responses return a configured boolean,
  never a saved key. A blank replacement input preserves the key; an explicit
  disconnect clears it. Do not copy existing token-echoing behavior.
- Authenticate and resolve the authorized merchant before data access; preserve
  existing growth integration entitlement and expiry checks. Enforce permissions
  on reads and updates, rather than trusting a request-selected merchant.
- Store keys only through the authorized server path. Never put keys in URLs,
  screenshots, logs, public projections, or client bundles.

## Browser contract

- Load `https://bzrcdn.openai.com/sdk/oaiq.min.js` once using the repository's
  script-loading pattern. Initialize only with that merchant's public Pixel ID.
- Connect to the existing cookie-consent updates. Initial denial blocks
  measurement; withdrawal calls the SDK consent method and stops future events.
- Start with page measurement and paid conversion. Do not count a client order
  creation as a paid conversion. Upper-funnel events may follow the existing
  documented event mappings where the current source is unambiguous.
- Paid browser events require server-confirmed order state and a stable order
  conversion ID also used by CAPI. Audit the existing checkout event ID before
  choosing whether to reuse it or consistently use `purchase_<order ID>`.
- Persist consent-eligible `__oppref` and `__obref` with checkout tracking for
  delayed webhook conversions. Never synthesize a click reference.
- Inspect CSP first. If the required changes touch `src/proxy.ts`, obtain the
  user's explicit authorization for that protected file; do not weaken CSP.

## Server delivery contract

- Standard event: `order_created`; Ads Manager display name:
  **Successful payment**. Its emission condition is full payment confirmation.
- Endpoint: `https://bzr.openai.com/v1/events?pid=<pixel ID>` with the CAPI key in
  a server-only Authorization header. Include `integration_source: "baci"`.
- Use integer currency minor units for the full order total; use the order's
  authoritative currency and support zero-decimal currencies correctly.
- Include stable event ID, original paid-event time in milliseconds, and the
  merchant's trusted storefront URL. Do not accept arbitrary request URLs as
  server event destinations. Use the appropriate documented action source.
- Forward available attribution references and only eligible matching data.
  Normalize before hashing; never send raw email or phone identifiers.
- Extend the durable paid route, adapter, destination schemas, active-destination
  selection, and database constraint in a new migration. Reuse durable retry
  identity and its original timestamp. Never turn failed/pending orders into
  paid events, and never replay historical sales by default.
- Add equivalent support to the still-active legacy paid fanout, preserving
  migration flags and the merchant's offline conversion opt-out. Avoid sending
  the same event independently through both pipelines; retain dedup identity.
- Redact provider errors, use bounded timeouts, classify retryable failures,
  and keep conversion failure from changing payment settlement results.
- Do not add any service-role user-facing edge. Any worker changes must remain
  within the repository's current explicit authorization contracts.

## Validation and release

Write regression coverage before implementing runtime behavior: authenticated
merchant-scoped settings, unauthorized tenants/staff, secret redaction,
entitlement expiry, consent denial/withdrawal, attribution capture, currency
minor units, stable event IDs, provider errors/timeouts, duplicate settlement,
paid orders, and unpaid/pending/failed/partial/cancelled orders.

Run affected web tests and `pnpm turbo lint typecheck --filter=@baci/web` if
the final diff remains isolated to the web app with understood impact. Shared
contracts or cross-app/infrastructure changes require the full monorepo checks.
Replay migrations and RLS checks in a disposable database. Before committing
code, run `coderabbit review --agent -t uncommitted` and address valid critical
or high findings; report reviewer unavailability as a gate blocker.

Configuration creation, local implementation, reviewed PR, migration application,
deployment, ingestion, and attribution are separate milestones. Production
activation follows the approved VPS prebuilt deployment flow only within the
user's deployment authorization. No campaign activation or ad spend is included.

## Implementation refinements

The existing `/dashboard/integrations/chatgpt` route manages website-builder
connections, so the new ads path is `/dashboard/integrations/chatgpt-ads`.
Only the public Pixel ID lives in feature settings. A separate RLS-scoped
credential table grants owners write access and metadata reads, while denying
saved-key reads even to the owner through the authenticated Data API. The
normal authenticated settings RPC remains SECURITY INVOKER. Its feature-row
lock serializes credential saves, allowing key rotation without granting key
SELECT privilege for UPSERT.

The durable dispatcher handles ChatGPT separately from the legacy multi-provider
fanout. The canonical paid-event identity and time pass through unchanged.
Database router, delivery constraint, claim schema, diagnostics and operator
replay filters all recognize the new destination. Existing rollout flags remain
in force; configuration does not activate delivery automatically.

The Pixel uses `measureSingle` to prevent cross-merchant broadcast when multiple
Pixel IDs were initialized in a browser session. Checkout attribution is read
again at submission to capture asynchronously set cookies and consent changes.

## Outstanding external action

The conversion-key form is prepared with name **Baci Ogabassey payments**.
Generating this credential requires action-time confirmation under the browser
policy. Its secure storage destination must be ready before capturing it; do not
generate it merely to leave a secret in chat or a screenshot.
