# Bank card offer payment recovery

Bank offers require a signed-in shopper whose account email matches the checkout email. The saved order must belong to that customer before a payment attempt can be claimed. Guest shoppers can still use standard checkout.

`BANK_CARD_OFFERS` in the server is the source of truth for merchant eligibility, offer dates, eligible products, discount rate and cap. The checkout route signs the quote and order together. The database checks that proof, validates the allocations against the order, and saves the result for verification and refunds. It does not maintain a second offer configuration.

Web and mobile clients must send `expected_total` for bank-offer orders. It is the total the shopper accepted after the offer and fees. If it is missing or differs from the server quote in kobo, checkout returns `BANK_CARD_OFFER_TOTAL_MISMATCH` before creating an order. Clients should refresh the total and ask the shopper to confirm it.

A bank-offer order requires one verified Paystack capture at the saved discounted total. The database rejects other payment legs, including manual and fallback payments, because they cannot prove eligibility for that discount. If a shopper wants to switch payment methods, reconcile the original attempt and cancel the bank-offer order before creating a standard order.

A signed-in customer can replay an already-created order with the same idempotency key and checkout request after an offer is disabled. This recovers the saved order and its post-creation work. Fresh orders still require an enabled offer, and payment attempts remain subject to the saved deadline.

The offer deadline closes new checkouts and payment attempts. An attempt opened before the deadline retains its saved price and approval rules if Paystack settles it later.

For an initialization review, look up the original reference with Paystack. If Paystack provides a usable checkout URL for that reference, authorized operations can call `restore_bank_card_offer_checkout_url` with the review ID and that URL. If Paystack confirms the reference cannot accept a charge, authorized operations can call `retire_bank_card_offer_initialization` with the review ID and the provider confirmation. The shopper can then retry on the same order if the offer is still available. A timeout or a missing verification result is insufficient to retire the reference.

The checkout URL validators in TypeScript and migration `20261119153530` both preserve Paystack query parameters. The database recovery test exercises saving and restoring a URL with a query string.

When Paystack verification reports a failed, abandoned, or cancelled attempt, checkout stops returning the old URL and opens a review. Operations must confirm that this reference cannot accept a charge before retiring it, including when the checkout was already initialized.

A terminal provider status belongs in terminal review only when the reference, payment domain, and currency match the saved attempt. Otherwise the evidence goes to the ambiguous capture review queue and cannot establish that the saved attempt is terminal.

For a capture review, reconcile the payment with Paystack under the original reference. Preserve the saved order and attempt while evaluating the provider evidence. The customer verification endpoint reports this state as pending with HTTP 202. The webhook returns HTTP 200 once the review is recorded so Paystack can stop retrying the delivery.

When a signed webhook has no matching saved bank-offer attempt, platform operations should look up the `payment_match_zero_candidates` review by `paystack_ref`. The row is intentionally unassigned because tenant and order identity come from the saved attempt. The webhook metadata does not establish that relationship.

Hosted storefront callbacks use HTTPS with both Paystack test and live keys. Non-production localhost can use HTTP for local QA with mocked Paystack responses.

Before switching between Paystack test and live keys, finish or reconcile outstanding attempts with the original domain's credentials. Confirm abandoned references cannot charge before retiring them. Retain access to the original domain for payment reconciliation and refunds. Reusing a saved attempt across domains is blocked by design.
