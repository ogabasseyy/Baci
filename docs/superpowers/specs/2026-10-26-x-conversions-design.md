# X website conversions

Merchants configure their existing X Pixel and individual X event codes in Baci. Browser events use the code matching that merchant's Pixel, check marketing consent on every send, and mount once in the persistent storefront shell. Product/cart/checkout events use normal storefront currency and public catalog IDs. Browser helpers never elevate checkout intent into a paid purchase.

Confirmed paid orders use Baci's existing durable event router and paid-order hydration. An X destination checks stored marketing consent and merchant entitlement, loads the owner's separately stored OAuth 1.0a credentials, and sends the merchant's configured Purchase event. The static X event ID differs from the canonical conversion_id. Missing configuration/consent is skipped; only a confirmed provider processed-count receipt is delivered. Existing queue retry/indeterminate behavior remains authoritative.

Approaches: the existing generic twq track helpers are incompatible with per-event codes; browser-only would omit confirmed server payments. Use the existing queue plus a dedicated X adapter. Secrets never appear in public projections or status responses. Owner-only settings use normal authenticated RLS; no new service-role route or privilege exception.

Official references: https://help.x.com/en/business-and-advertising/conversion-tracking-for-websites ; https://docs.x.com/x-ads-api/measurement/web-conversions ; https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests . Provider account eligibility and credentials remain live setup prerequisites. Parent approved this implementation scope on 2026-10-26.
