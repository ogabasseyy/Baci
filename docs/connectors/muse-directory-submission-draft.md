# Muse Directory Submission Draft — Baci Merchant Connector

Status: **draft for owner review; not submitted** (4 October 2026).

This document records verified public listing facts, the current read-only
connector scope, and items that must be completed before the Muse review can
exercise a live endpoint. Production read-only scope was separately approved;
the isolated staging pilot is still distinct from production verification.

## Overview form

| Field | Draft value | Status |
|---|---|---|
| Connector name | Baci Merchant Connector | Ready |
| Company or developer | Baci (OGABASSEY SERVICES LIMITED) | Confirm the legal submitter/entity before final submission; the Baci App Store listing names OGABASSEY SERVICES LIMITED as provider. |
| Product website | `https://usebaci.com` | Public site verified |
| Payments | My connector does not accept payments | Accurate for the read-only connector; it does not take payments inside Muse. |
| Support | `support@usebaci.com` | Public Baci contact |
| Privacy policy | `https://usebaci.com/privacy` | Public URL; publish the connector-specific disclosure before submission. |
| Terms of service | `https://usebaci.com/terms` | Public URL; confirm these cover the connector relationship before submission. |
| Example prompts | “Show my recent orders with payment and shipping statuses shown separately.” “Check branch inventory and flag low-stock items.” “Summarize order counts, revenue, and stock levels for my store.” | Read-only capability wording |
| Name and work email | Bassey John; `support@usebaci.com` | Draft business contact values restored from the previous form preparation; verify before final submission. |
| Connector icon | Baci gold shopping-bag mark from the user-provided SVG, fitted to 512×512 | Attached in the Muse Overview form; local copies are `docs/connectors/muse-baci-icon.svg` and `docs/connectors/muse-baci-icon.png`. The old `android-chrome-512x512.png` was visibly corrupted and should not be used. |

## Technical specs form

- **Connection type:** Raw API / OpenAPI.
- **Endpoint and OpenAPI URL:** filled as draft values in the Muse form. The host is
  `muse-api.usebaci.com`, with OpenAPI at
  `https://muse-api.usebaci.com/openapi.json` and docs at
  `https://muse-api.usebaci.com/docs`; DNS points to the VPS and TLS is installed,
  but the stopped gateway still returns 502. The pilot used an ephemeral
  Cloudflare tunnel, which has been stopped. Do not reuse its URL or token.
  Start the approved production runtime and verify both URLs before submission.
- **Authentication:** per-merchant bearer API key. Each owner creates an
  agent-specific grant in Baci Dashboard → Integrations → Muse, selects the
  read scopes and branch coverage, then enters that token in Muse’s secure
  credential prompt. One grant is independently revocable per agent.
- **Test account:** not ready. Create a dedicated reviewer owner and synthetic
  merchant dataset in an isolated environment, and keep it available for the
  full review period. Never provide a production merchant's credentials.
- **Tool permissions:** all four tools are reads. No tool creates or modifies
  orders, products, inventory, payments, refunds, or store settings.

The Muse Technical Specs form is set to **Raw API** and **API keys**. Its Access
requirements field explains the read-only and per-merchant grant boundaries and
notes that production runtime verification and reviewer access remain pending.
The stable API, OpenAPI and documentation URLs are filled in the draft;
they are not yet usable for review while the gateway is stopped.

| Tool | Behavior | Scope |
|---|---|---|
| `orders.list` | Reads bounded order IDs, branch IDs, payment/shipping statuses, and creation times. | `orders:read`; grant merchant and branch limits apply. |
| `orders.get` | Reads one visible order's same safe projection. | `orders:read`; out-of-scope orders are not returned. |
| `inventory.levels` | Reads SKU/variant and branch identifiers, available/reserved/sold counts, and low/out-of-stock flags. | `inventory:read`; grant merchant and branch limits apply. |
| `analytics.summary` | Reads aggregate order/payment/shipping and stock counts, including paid revenue. | `analytics:read`; grant merchant and branch limits apply. |

Payment and shipping status remain separate. Store selectors narrow a validated
grant; they never grant authority. Business reads use the linked owner’s RLS
context. Baci records an audit row with grant ID, route, status, and latency;
the audit table has no request payload, credential, or returned-row columns.

## Data-handling answers to finalize

The connector disclosure is drafted in the local platform privacy page. It
covers merchant-authorized read-only access, grant scope, the order, inventory,
or aggregate analytics data returned for a tool request, Baci's audit fields,
one-year retention for audit records and inactive grant metadata, disconnect
behavior, and the AI service's own data practices. Production has four
connector migrations applied; the purge function and daily schedule are present
and its regression passed transactionally. The policy update has not been
published and still needs owner/legal review. Confirm the AI provider's current
legal entity, processing role, and subprocessors before naming them or
answering Muse's questionnaire:

1. What merchant data Muse receives and uses for the requested read (orders,
   inventory, and aggregate analytics).
2. The Baci/Muse/Meta processing roles and any downstream processors.
3. One-year retention for grant metadata and audit rows; separately confirm
   Muse-held credential retention and deletion behavior on disconnect and
   account deletion.
4. The support/security contact and incident response path for connector
   access.

Do not claim the privacy notice has been published until deployment and a fresh
public URL check. Muse-held credential retention must be confirmed separately.

## Gates before advancing to Review

1. **Complete:** production read-only scope is accepted, including the
   owner-only `variant_inventory` policy; active staff remain excluded.
2. **Complete:** all four production migrations, DNS, TLS, and the HTTPS path
   allowlist are installed. The gateway runtime remains stopped.
3. **Open:** provision the production runtime secret safely, start the gateway,
   and verify discovery, auth denial, rate limits, audit, merchant/branch
   containment, revocation, and outage behavior from the public network.
4. **Open:** provision isolated reviewer credentials and synthetic data; revoke
   them after review if submission is not approved or the review ends.
5. **Open:** publish the connector privacy disclosure after owner/legal review;
   verify support, legal entity, company work email, and approved icon.
6. **Owner action:** review Muse Connector Platform Terms and personally accept
   any legal terms and submit the final application.

## Staging pilot evidence (operator-reported)

On 3 October 2026, the operator reports all four calls succeeded against the
R1 staging connector using synthetic data: `orders.list` 200 (3 orders),
`orders.get` 200, `inventory.levels` 200 (2 levels), and `analytics.summary`
200 (3 orders / 400 revenue / stock counts). The operator reports no writes
and confirms the pilot credential was revoked, the database login disabled,
the gateway/proxy/tunnel stopped, temporary secrets deleted, and the branch
paused. These observations are pilot evidence only, not production proof.


## Current completion gaps

- Production's migration ledger contains four connector migrations, including
  the role-safety assertion. A
  live read-only check confirmed the retention function, daily cron entry,
  disabled client execution, `connector_gateway` still `NOLOGIN`, and zero
  active grants. The prior CLI dry run covered only the first two migrations.
- The one-year purge regression passed transactionally and rolled back its
  synthetic rows. The privacy disclosure remains unpublished pending review.
- Official Muse review materials require a dedicated test user, a reviewer-
  accessible demo, accurate retention/deletion disclosures, verified business
  details, and an end-to-end run. See
  `muse-submission-test-cases.md`; it is a draft, not a recorded demo or a
  completed Muse review.
- DNS, TLS, and the Nginx path allowlist are live, but the API/OpenAPI/docs
  requests return 502 while the gateway is stopped. The Muse form has its
  Overview, logo, Access requirements, API, OpenAPI and documentation URL
  fields prepared as a draft. No submission was sent.
- The connector privacy disclosure is now drafted in the Baci platform privacy
  page code and has a rendering test, but it is not yet deployed to the public
  policy URL.
