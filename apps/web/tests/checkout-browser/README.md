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
- A resumed order with an empty cart. This caught an actual repeated-fetch
  render loop hidden by the original unit mocks; editing hydrated details must
  not trigger another load.

Orders, shipping, tax and payment initialization use deterministic intercepted
responses. This is browser UI/integration evidence, not a live sign-in test,
full tenant/proxy route test, database RLS test, or provider settlement proof.
Real provider cancellation, webhook delivery, refunds and reconciliation remain
separate sandbox/staging gates. The successful payment-handoff page does not
represent a charge or paid order.
