# Saved plan comparison

The checkout shows the down-payment selector and booked breakdown together.
Confirmed 25%, 35% and 50% plans from the existing staging application are cached
by workflow, product amount, equity percentage and tenure. The cache retains the
first reference for each exact combination. Subsequent responses with that same
reference can refresh its breakdown; another reference does not silently replace
it. Returning to a cached selection never submits a booking.

The private cache stores only the booking's financial fields, schedule and
charges, excluding phone numbers, identity data, OTPs and activity tokens. Normal
customer-authenticated requests use `oxygen_saved_plans`; ownership is checked
against the workflow's customer, merchant and order. Direct private-table access
is denied. Changed order amounts invalidate saved options. Completed provider
states are captured automatically; no client endpoint accepts authored quotes.

Selection is an independently saved preference. It does not rewrite provider
state, clear pending commands, resolve supersedence, approve a loan or cancel
another reference. The current reconciliation hold remains. Approval controls are
suppressed while comparing cached plans. Uncached percentages/tenures are not
offered as confirmed plans and do not create bookings during comparison.

Writes are serialized and coalesced during rapid switching, while the displayed
breakdown changes immediately. Save failures preserve the preview, show an error
and offer an explicit retry. Reopening reloads the saved preferred reference.

Only the isolated savings staging database received the new migration. Existing
25%/35% responses were imported through the private cache helper after schema and
breakdown validation; the existing 50% state was captured by migration backfill.
No provider mutation was needed to populate or test this screen. The existing
staged, unstaged and untracked work was preserved. No production deployment,
approval, cancellation, activation or settlement was performed.

Cache isolation: a follow-up append-only migration makes cache maintenance
best-effort. Invalid snapshots and cache-key conflicts cannot roll back the
provider state write. The failure regression reproduced a unique-reference
collision before the fix and confirmed successful provider-state persistence
afterward, including malformed/missing numeric fields. Cache misses remain
visible rather than causing another booking. Approved loans keep their actual
breakdown fixed; cached alternatives are never shown beside another loan's
payment link.

Review: scoped CodeRabbit reviews covered the accumulated component, API, schema
and SQL work. The new route's transient-error mapping and the cache-trigger
failure isolation were corrected with regression tests. Low-priority comments
on pre-existing draft, webhook, callback and validation code remain outside
this change. App-wide Biome still reports the two existing orders-file formatting
errors; targeted checks cover the files changed here.
