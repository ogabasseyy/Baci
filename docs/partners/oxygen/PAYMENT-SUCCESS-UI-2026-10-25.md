# Payment confirmation screen — 25 October 2026

## Customer behavior

The existing checkout dialog shows **Payment confirmed** only when the selected booking's trusted payment status has both `paymentComplete` and `setupComplete` true and no pending recovery command. The selected upfront amount is shown only from a saved booking whose two reference fields match the confirmed reference. Missing/mismatched amounts are omitted. Existing order product data is reused.

The screen includes confirmation markers for upfront payment and repayment setup, a compact product summary, **Awaiting order confirmation**, a collapsed selected-plan breakdown, and **Back to checkout**. Payment confirmation does not claim fulfilment, delivery, settlement or completion of the previously indeterminate approval. The return button only closes the existing dialog.

Confirmation arriving while the hosted page is open closes that hosted view and reveals the success screen. Closing/loading the iframe alone cannot produce success. Partial/unknown status and failed reads stay outside the success screen. Original runtime approval history, activation and settlement contracts are unchanged.

## Mocked validation

The component/return-flow tests use mocked API responses. The development-only route `/template-preview/oxygen-payment-success` renders the same success component with a fixed, parsed status fixture, synthetic reference and the existing selected-plan/product figures. It displays **MOCKED PREVIEW · No payment was made**. The fixture makes no API requests or storage writes. Production and other non-development environments return not found.

The actual booking remains outside the fixture. Its last real status check was HTTP 200 at 06:45:26 Africa/Lagos: upfront payment incomplete and repayment setup complete. See PAYMENT-STATUS-2026-10-25.md.

## Verification

67 focused tests passed across the success component, fixed preview, development-only route gate, payment recovery, automatic return checks, existing workflow, application dialog, hosted page and recovery service/API. Web and tools-worker typechecks and changed-file Biome checks were run. Full web lint was also attempted and encountered the same two pre-existing formatting errors in `src/app/api/orders/route.ts` and `src/app/api/orders/order-security.test.ts`; unrelated files were preserved.

The fixture route returned HTTP 200 after compilation. Automated visual verification was not completed: browser-only response interception did not reliably deliver the fixture to the mounted view, and subsequent navigation landed on an error document that the browser URL policy prevents automation from observing/reloading. Raw interception was cleared; no persistent browser scripts were installed. The development-only preview can be opened manually at the URL above. Do not describe the screen as visually verified or the actual payment as complete.

No OTP, booking, approval, cancellation, activation, settlement, deployment, commit or staging operation was performed for this UI change. The original staged patch remains byte-for-byte preserved.
