# Address autocomplete provider fallback

The web address field requests `GET /api/places/autocomplete` with
`fallback=geoapify`. Google remains first; Geoapify handles an exhausted application
budget, provider quota/authentication/network failures, or no Google matches.
Older native clients omit this parameter and continue receiving only Google
predictions, because they do not support inline Geoapify details or attribution.

Geoapify predictions include normalized address fields. Selecting one uses those
fields directly and makes **no Google Place Details request**. The key is stored
as sensitive `GEOAPIFY_API_KEY` in Vercel Preview and Production. It is never
returned to clients or placed in a public environment variable. Credential-bearing
fetch URLs are excluded from exported telemetry spans.

## Limits

An isolated Redis database configured through `ADDRESS_AUTOCOMPLETE_REDIS_REST_URL`
and `ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN` provides atomic shared counters across
deployments. `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` are supported as fallbacks.
URL and token must come from the same configuration pair.
If distributed storage is unavailable, admission fails closed; there is no local
counter that could reset on a serverless restart.

- Google: **4,500 combined upstream attempts per Pacific calendar month**, counting
  autocomplete, Details and retries. New predictions stop at 4,400, leaving 100
  attempts for outstanding selections. This is a conservative application cap,
  not a measurement of all SKUs or other projects sharing the billing account.
- Geoapify: **2,800 attempts per rolling 24 hours**, with at least 250 ms between
  admissions. This leaves headroom below the Free plan's 3,000 credits/day and
  five requests/second. A request arriving just after another admission waits for
  capacity and retries once. Other account usage still consumes its quota.
- Before release, initialize the current Google month as exhausted when earlier
  usage is untracked. The next month's counter begins automatically at the Pacific
  month boundary. No existing cloud quotas are raised.

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
required CodeRabbit gate before submission. Key configuration alone does not
change live checkout. A healthy persistent Redis database and current-month counter
initialization are release prerequisites. The previous Vercel Redis integration
was uninstalled and its configured hostname no longer resolves.
Merge, approved VPS prebuilt deployment and public checkout
verification are separate release steps.

Provider references: [Geoapify autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/),
[Geoapify pricing and attribution](https://www.geoapify.com/pricing/),
[Google SKU pricing](https://developers.google.com/maps/billing-and-pricing/pricing).
