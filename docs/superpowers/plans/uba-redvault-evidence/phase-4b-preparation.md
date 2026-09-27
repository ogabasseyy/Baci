# Phase 4B mobile preparation evidence

## Scope

Prepared an isolated React Native presentational REDVAULT payment choice and colocated Jest React Native tests. Checkout integration remains locked pending Phase 3 acceptance under the accelerated-preparation ruling.

## Changed files

- `apps/mobile-storefront/components/checkout/redvault/RedvaultPaymentChoice.tsx`
- `apps/mobile-storefront/components/checkout/redvault/RedvaultPaymentChoice.test.tsx`

SHA-256 manifest:

- `RedvaultPaymentChoice.tsx`: `43924b4a045c57358a6c9c18eb70cc8d21a15c3ac25b96e0f4a3aec62be1c7fd`
- `RedvaultPaymentChoice.test.tsx`: `f899d21522f12fdfa8b01b1021bb5957aa8547d221ec77c54c9b08467e4aba68`

## Interface

`RedvaultPaymentChoice` accepts explicit `available`, `selected`, `status`, `summary`, and `onSelect` props. The server-provided `summary` is rendered verbatim for eligibility, mixed-basket explanation, product/eligible subtotals, discount, tax, shipping, gift wrapping, and payable total. Kobo is formatted only for display; no discount or payable amount is calculated in the component.

## Coverage

- unavailable offer is hidden
- selected radio choice invokes the supplied callback
- all frozen server totals render
- mixed and all-excluded baskets explain/disable the choice correctly
- pending, held, and error states render explicitly; held states payment receipt and verification pending without claiming order success or requesting another payment

## Commands and results

- `pnpm exec biome check components/checkout/redvault/RedvaultPaymentChoice.tsx components/checkout/redvault/RedvaultPaymentChoice.test.tsx` — passed.
- `pnpm exec tsc --noEmit --pretty false` — passed.
- `git diff --check` — passed.
- `pnpm exec jest --runTestsByPath components/checkout/redvault/RedvaultPaymentChoice.test.tsx --runInBand --watchman=false` — passed: 1 suite, 8 tests. Jest emitted its configured force-exit open-handle advisory after the successful suite.

## Blockers and prohibited operations

No checkout wiring, app route export, networking, Paystack/card input, merchant activation, shared/backend/SQL change, database access, payment, deployment, commit, push, or remote operation was performed. This is preparation evidence only and requires parent review.
