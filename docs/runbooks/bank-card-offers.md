# Bank card offer payment recovery

Bank offers require a signed-in shopper whose account email matches the checkout email. The saved order must belong to that customer before a payment attempt can be claimed. Guest shoppers can still use standard checkout.

A bank-offer order requires one verified Paystack capture at the saved discounted total. The database rejects other payment legs, including manual and fallback payments, because they cannot prove eligibility for that discount. If a shopper wants to switch payment methods, reconcile the original attempt and cancel the bank-offer order before creating a standard order.

For an initialization review, look up the original reference with Paystack. If Paystack provides a usable checkout URL for that reference, authorized operations can call `restore_bank_card_offer_checkout_url` with the review ID and that URL. If Paystack confirms the reference cannot accept a charge, authorized operations can call `retire_bank_card_offer_initialization` with the review ID and the provider confirmation. The shopper can then retry on the same order if the offer is still available. A timeout or a missing verification result is insufficient to retire the reference.

When Paystack verification reports a failed, abandoned, or cancelled attempt, checkout stops returning the old URL and opens a review. Operations must confirm that this reference cannot accept a charge before retiring it, including when the checkout was already initialized.

For a capture review, reconcile the payment with Paystack under the original reference. Preserve the saved order and attempt while evaluating the provider evidence. The customer verification endpoint reports this state as pending with HTTP 202. The webhook returns HTTP 200 once the review is recorded so Paystack can stop retrying the delivery.

When a signed webhook has no matching saved bank-offer attempt, platform operations should look up the `payment_match_zero_candidates` review by `paystack_ref`. The row is intentionally unassigned because tenant and order identity come from the saved attempt. The webhook metadata does not establish that relationship.

Hosted storefront callbacks use HTTPS with both Paystack test and live keys. Non-production localhost can use HTTP for local QA with mocked Paystack responses.
