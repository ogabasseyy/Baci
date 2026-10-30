# Address autocomplete provider fallback

The web address field requests `GET /api/places/autocomplete` with
`fallback=geoapify`. Google remains first; Geoapify handles an exhausted application
budget, provider quota/authentication/network failures, or no Google matches.
Unexpected internal errors or malformed Google JSON return a safe 500 without
spending Geoapify credits; exhausted transport errors remain fallback-eligible.
An absent Google key also permits the explicitly requested, budgeted Geoapify
fallback. Clients without that opt-in still receive the Google configuration error.
Older native clients omit this parameter and continue receiving only Google
predictions, because they do not support inline Geoapify details or attribution.

Geoapify predictions include normalized address fields. Selecting one uses those
fields directly and makes **no Google Place Details request**. The key is stored
as sensitive `GEOAPIFY_API_KEY` in Vercel Preview and Production. It is never
returned to clients or placed in a public environment variable. Credential-bearing
fetch URLs are excluded from exported telemetry spans.

## Limits

The private `address_budget` PostgreSQL ledger in the existing Supabase project
provides atomic shared reservations. Redis is no longer consulted by these
address endpoints. Unrelated Redis consumers and their configuration are unchanged.
The server uses the existing scoped JWT signer and a dedicated role that can POST
only `reserve_address_provider_request`. It cannot initialize allowance, change
usage history or read orders. Unknown allowance, credential mismatch, expiry,
database failure and ambiguous commits all deny a provider request.
There is no process-local admission in development or production.
Preview and staging requests using these credentials consume the same counters
as production. Separate environment counters would multiply the allowance for
the same provider account. Automated tests mock provider requests and counters.

- Google: **4,500 combined upstream attempts per Pacific calendar month**, counting
  autocomplete, Details and retries. New predictions stop at 4,400, leaving 100
  attempts for outstanding selections. Each retry reserves its own unit, so one
  keystroke under persistent transport failure or UNKNOWN_ERROR can spend up to
  3 units (initial attempt plus 2 retries). This is a conservative application cap,
  not a measurement of all SKUs or other projects sharing the billing account.
- Geoapify: **2,800 attempts per rolling 24 hours**, with at least 250 ms between
  admissions. This leaves headroom below the Free plan's 3,000 credits/day and
  five requests/second. A request arriving just after another admission waits for
  capacity and retries once. Other account usage still consumes its quota.
- Account-wide usage and bounded liability from old deployments must be verified
  before owner-only initialization. Unknown usage remains unavailable; it is never
  imported as zero. Each new Google billing month requires fresh authorization.
  Geoapify imported debt lasts at least 24 hours from verification; expired debt
  can be replaced only with fresh owner evidence. Recent reservations remain counted.
- The shared monthly counter has no per-caller partition beyond the proxy's
  per-IP minute throttle, so a sustained single-source burst can exhaust the
  month for everyone. Guest checkout is intentionally unauthenticated; closing
  this residual needs product-level controls (account binding, captcha, or
  per-IP daily partitions) and is out of scope for this change.

Geoapify requires its attribution and data-source credit. Both links appear in
the dropdown and remain near the address after selection. Address fields remain
editable. Failure of both providers exposes a manual-entry message rather than
silently showing no suggestions.

Coordinates are returned only for a confident street/building/amenity match.
City/postcode centroids and low-confidence guessed house numbers are not passed
off as delivery locations. Street coordinates still do not prove an exact doorstep.
Written address, city/state and the existing shipping flow remain necessary.

## Verification and release

Run the colocated provider-budget, autocomplete-route, selection and field tests,
plus the checkout delivery address/quote tests. Run web lint and typecheck and the
required CodeRabbit gate before submission. The release stages the request guard,
observes its anonymous reload canary, and only then grants the reservation role.
Key configuration or code publication alone does not enable lookup calls: verified
allowance is a separate prerequisite. Follow [the cutover runbook](address-budget-postgres-cutover.md).
Merge, the checked worker/web release and public checkout verification are separate
steps. Manual entry and existing Store Pickup remain usable while lookup allowance
is unavailable; they do not supply a courier destination pin.

Provider references: [Geoapify autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/),
[Geoapify pricing and attribution](https://www.geoapify.com/pricing/),
[Google SKU pricing](https://developers.google.com/maps/billing-and-pricing/pricing).
