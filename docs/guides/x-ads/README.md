# X Pixel and confirmed-payment conversions

Open Baci → Integrations → Twitter (X). Select the existing website Pixel in X Ads → Tools → Events Manager. Paste its Pixel ID into Baci. For each action you want to measure, open that event's installation code in X and paste the complete `tw-PIXEL-EVENT` code into the matching Baci field. Event IDs must belong to the same Pixel. A base Pixel ID alone does not configure ecommerce events.

Browser product, cart and checkout observations require the visitor's current marketing consent. The Pixel mounts in the persistent store shell, including direct product landings. Browser helpers never turn a checkout submission into a successful payment. Merchant event maps are bounded public configuration; credentials stay private.

For server delivery, use an X Ads API-approved application and OAuth 1.0a credentials for a user with account access. Paste all four fields into Baci's masked server settings. Later saves can leave all credential fields blank to retain saved access. Saved status exposes only credential presence. Disconnect removes the saved credentials and event map.

Only a fully paid order is eligible for the X server Purchase event. Baci's existing durable worker reloads the merchant-scoped order and requires an affirmative marketing choice stored at checkout. Missing consent is skipped, including historical orders without a recorded decision. The Purchase event's configured X ID is different from the per-order `conversion_id` used for deduplication. Values remain in the order's ISO currency and normal major units; catalog IDs come from the paid line items. Available email/valid E.164 phone values are SHA256 hashed before transmission.

## Verification and tutorial capture

1. Capture X Events Manager's existing Pixel and event-code screen; keep credentials out of the image.
2. Capture Baci's saved Pixel/event mapping and masked credential-presence status.
3. Test Necessary only, then Accept all through the actual storefront consent controls. Check a direct product landing, add-to-cart and checkout observation in X's event activity.
4. Use a separately approved controlled payment for Purchase. Match the canonical order event ID to the worker delivery record and the X activity receipt. Do not fabricate a client Purchase or reuse an existing real order as a synthetic payment.
5. A worker row is marked delivered only after HTTP success and a numeric positive `conversions_processed` receipt. A saved token, queued event or successful empty response is not delivery proof. Record browser receipt, server processed receipt, and reporting/attribution separately.

No live X receipt is claimed by this guide. Provider account setup, approved destination activation, deployment and controlled paid-order verification remain operational steps.

References: [X website tracking](https://help.x.com/en/business-and-advertising/conversion-tracking-for-websites), [web conversion API](https://docs.x.com/x-ads-api/measurement/web-conversions), [OAuth 1.0a requests](https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests).
