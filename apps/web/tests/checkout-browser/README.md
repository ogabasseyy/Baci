# Checkout browser regression gate

This isolated, production-built Next app imports the actual OgaBassey checkout,
cart and merchant providers, phone/address controls and storefront CSS. Its
catalog/cart pages only arrange real cart state and client navigation. Fixture
routes are outside the customer application and are never deployed with it.

```sh
pnpm install --frozen-lockfile
pnpm --filter @baci/web exec playwright install chromium webkit
pnpm --filter @baci/web test:checkout:build
pnpm --filter @baci/web test:checkout:browser
```

The build command also typechecks the browser tests. Tests start the built app
on port 3217; they deliberately refuse to reuse an unknown existing server.
Failure traces/screenshots go to `$CHECKOUT_BROWSER_ARTIFACTS`, or the system
temporary directory under `baci-checkout-browser`. CI retains failures for seven
days. Test data is synthetic and the network guard rejects unexpected API and
external requests; keep production credentials out of this fixture.

## Coverage and limits

- Real visible/actionable checkout controls at 390, 1023, 1024 and 1440px, on
  direct entry and client navigation, with a late `.hidden` utility reproducing
  the original desktop failure. Reverting `max-lg:hidden` to `hidden` made the
  desktop Chromium test fail before the merged fix was restored.
- Labels, autofill, associated validation errors, invalid-field focus, step
  transitions and collapsed content in Chromium and WebKit.
- Guest and authenticated **session endpoint responses**, duplicate submit,
  persistence across a full navigation, and reuse of the same order on return.
- Interrupted order creation followed by a full reload: the second request
  retains the same body and idempotency key, and only the recovered response
  opens payment. This covers both session responses in Chromium and WebKit.
- VAT preview and submission use local arithmetic without a remote
  `calculate-commerce` request.
- A resumed order with an empty cart. This caught an actual repeated-fetch
  render loop hidden by the original unit mocks; editing hydrated details must
  not trigger another load.

Orders, shipping and payment initialization use deterministic intercepted
responses. Tests can permit a bounded number of exact console messages for
injected failures; unhandled page errors and unexpected network requests still
fail the suite. This is browser UI/integration evidence, not a live sign-in test,
full tenant/proxy route test, database RLS test, or provider settlement proof.
Real provider cancellation, webhook delivery, refunds and reconciliation remain
separate sandbox/staging gates. The successful payment-handoff page does not
represent a charge or paid order.

For a manual local browser pass, run the built harness, open `/catalog`, click
**Add test phone**, then open `/checkout?qa=manual`. The checkout starts empty;
the yellow fixture panel is visible only with this
explicit query parameter. Its controls select successful or always-failing
payment initialization and reset cart, checkout and pending-order browser
state. The harness serves synthetic local responses for shipping, order
creation/reuse and payment initialization; payment handoffs stay on
`/payment-handoff`, and no provider or real order is contacted. The saved-address
selector is unavailable in the current checkout implementation, which
initializes its saved-address list empty; use the real new-address form and
both delivery choices for manual QA.

The local shipping quote fixture prices both door and pickup at zero, matching
the deterministic single-item order's zero shipping fee and fixed ₦107,500
total (₦100,000 subtotal plus ₦7,500 VAT). It does not calculate dynamic
checkout amounts or stand in for server-side amount authority.

For an isolated crypto modal browser pass, open
`/crypto-payment-modal`. This harness-only page mounts the real
`CryptoPaymentModal` with a synthetic address and an inline data-URI image.
Choose an idle, checking, pending, confirmed, or failed verification state
before opening the modal. The header close button dismisses immediately; the
footer close button uses the browser confirmation dialog. Clipboard interaction
uses the local browser clipboard permission. The fixture does not call a
payment provider or the crypto initialization and verification APIs, so it
checks the modal UI only, not checkout hook integration.

The panel is covered by Playwright. The browser suite also switches the real
payment controls between Paystack and Korapay, injects a provider
initialization error, then retries against the same order using the reuse API.
