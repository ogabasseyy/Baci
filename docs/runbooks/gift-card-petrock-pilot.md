# Ogabassey gift-card pilot

The browser preview and the supervised worker are separate. The worker requires a durable, already-paid gift-card order ID. The live confirmation form is available only to the signed-in pilot customer when explicitly enabled. It performs a fresh supplier and Juicyway price check again before debiting. All quote refreshes reuse the configured pilot order ID, so they cannot initiate a second debit or supplier order.

Before a live pilot, deploy and verify the wallet authorization and order creation path, the worker migrations, and the callback endpoint. Give a dedicated login membership in `gift_card_petrock_worker` and no direct access to order tables. Use the repository's managed secret store for `GIFT_CARD_WORKER_DATABASE_URL`, `PETROCK_API_BASE_URL`, `PETROCK_API_TOKEN`, and `GIFT_CARD_EVIDENCE_KEY_HEX` (32 random bytes, hex). Configure the feedback URL for the deployed gift-card callback using its independent `GIFT_CARD_PETROCK_CALLBACK_TOKEN`. Configure the intended product and approved price through `GIFT_CARD_PILOT_PRODUCT_ID`, `GIFT_CARD_PILOT_SUPPLIER_USD`, and `GIFT_CARD_PILOT_AMOUNT_KOBO`.

Keep the pilot disabled until the worker and callback are verified. Provision the quote HMAC as `GIFT_CARD_WALLET_QUOTE_HMAC` for the web server and as `gift_card_wallet_quote_hmac` in database Vault, with identical values. Configure `GIFT_CARD_PILOT_USER_ID` and a unique `GIFT_CARD_PILOT_ORDER_ID`. When the reviewed path is deployed, set `OGABASSEY_GIFT_CARD_PILOT=true` for this pilot only. Reconfirm the exact Juicyway total, wallet availability, and Petrock cost before the customer signs in and confirms the wallet charge. Record the paid order UUID and wallet ledger reference. Then run the worker once for that order:

```sh
pnpm --filter @baci/web process:gift-card-petrock-order submit <paid-order-uuid>
pnpm --filter @baci/web process:gift-card-petrock-order poll <paid-order-uuid>
```

The worker durably claims the order before placing it with Petrock. If it stops in `submitting` or `submission_unknown`, reconcile with Petrock by the paid order UUID as the supplier reference. Do not run another placement or refund until supplier acceptance or non-placement is confirmed. Polling is read-only once the provider order ID is recorded. The callback acknowledges but does not interpret the provider payload.

The terminal audit prints the order reference, normalized supplier state, and `[redacted]` in place of the replay. The replay itself is encrypted with an order-bound AES-GCM key for restricted inspection. The voucher format and customer delivery still need a sanitized completed response. Never copy the raw replay or voucher into PRs, logs, or shared fixtures.
