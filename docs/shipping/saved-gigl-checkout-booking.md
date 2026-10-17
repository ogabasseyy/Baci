# Booking a saved GIG checkout selection

For a paid domestic GIG order funded at customer checkout, the merchant can book
using its saved shipping selection. Baci checks the current tariff as part of
that request; the merchant does not need to refresh merely because the checkout
quote's one-hour freshness timestamp has passed. This does not make the saved
estimate a carrier price guarantee.

When the destination, parcel, origin, service and shipping economics still
match, booking keeps the existing quote binding and paid fee. The price check
alone does not save a replacement quote or change the order.

The service comparison uses the booking authority encoded in the GIG rate ID:
pickup mode, origin/destination stations, service centre, vehicle and delivery
class. Station display labels and estimated delivery windows are guidance, not
a different booked service; they are not treated as a customer price guarantee.

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

Legacy quotes with missing request data or trusted pricing economics also require
explicit recovery; they are not silently rebuilt during booking. Recovery reads
the current paid order, surviving items and optional saved service preference,
resolves the current merchant sender, and asks the merchant for a complete
Nigerian destination and pin. It obtains fresh quote economics and stages a
signed preview only when its customer fee equals the fee already paid. A
separate explicit confirmation saves that quote; booking remains a separate
action. Missing old quote data is not itself a recovery blocker. Missing retained
funding, pending refund reconciliation, unsupported pickup/international delivery,
or a different fresh fee still requires the existing review process.

International shipments, merchant-wallet funding, checkout quote expiry rules,
and the explicit recovery activation/rollback controls retain their existing
contracts. Eligible owners receiving a reconfirmation response are taken directly
to the mobile recovery form. Booking stays blocked until an explicit preview,
consent and save complete; saving never submits a shipment. Switching to self
fulfilment remains available. Updated mobile builds allow 30 seconds for shipping,
covering the sequential tariff check
and carrier submission; other status updates retain their 15-second deadline.
Both deadlines include response-body reading, and neither retries booking.
