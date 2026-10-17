# Booking a saved GIG checkout selection

For a paid domestic GIG order funded at customer checkout, the merchant can book
using its saved shipping selection. Baci checks the current tariff as part of
that request; the merchant does not need to refresh merely because the checkout
quote's one-hour freshness timestamp has passed. This does not make the saved
estimate a carrier price guarantee.

When the destination, parcel, origin, service and shipping economics still
match, booking keeps the existing quote binding and paid fee. The price check
alone does not save a replacement quote or change the order.

A complete pin on the order-bound saved quote can supply coordinates missing
from an otherwise matching order destination for that booking. Both coordinates
must be valid. A changed address, conflicting or partial order pin, or missing
saved pin requires destination review. Never substitute a carrier station's pin
for a customer's destination or manually repair production order data.

A changed tariff or service stops booking before carrier submission with
`SHIPPING_QUOTE_RECONFIRM_REQUIRED`. The merchant must review the existing
recovery flow; no shipping fee or merchant charge is silently changed. Existing
recovery cannot save a customer fee different from the paid amount; that case
requires separate reconciliation rather than repeated booking attempts. An
unavailable price check also stops before submission and can be retried as a
price check. A lost response after carrier submission remains indeterminate:
check shipment status before retrying.

International shipments, merchant-wallet funding, checkout quote expiry rules,
and the explicit recovery activation/rollback controls retain their existing
contracts. The existing mobile recovery flow supports these server responses. Updated
mobile builds allow 30 seconds for shipping, covering the sequential tariff check
and carrier submission; other status updates retain their 15-second deadline.
Both deadlines include response-body reading, and neither retries booking.
