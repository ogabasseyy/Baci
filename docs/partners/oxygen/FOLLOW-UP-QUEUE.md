# Oxygen merchant follow-up queue

This read-only staff queue describes saved workflow evidence and order state.
Categories do not authorize provider execution or prove current provider
availability. Selecting an Oxygen entry opens its order. The queue sends no
messages and changes no application, payment, or loan.

## Coverage and identity

The merchant-scoped `oxygen_follow_up_candidates` RPC returns order IDs,
categories, activity times, and customer binding only for customer-action rows.
Contact and order details are fetched separately through orders RLS with an
explicit merchant filter.

The ninth and tenth migrations admit failed, expired or BNPL-pending Oxygen orders regardless of
provenance, including staff-created and imported orders without a workflow.
They remain `needs_review`, with no exposed customer binding. The existing
merchant, cancellation and 90-day guards still apply. Unpaid manual orders
without a workflow remain excluded.

Orders currently marked Oxygen retain their own RPC capacity budget. The
standard source excludes that payment method so Oxygen failures cannot displace
standard follow-ups. The RPC can also surface booked-loan conflicts after a
payment-method change. For an overlapping order ID, the complete Oxygen row
wins: its review classification and order-detail navigation take precedence over
generic gateway text and aggregated customer attempts, which do not establish
the loan state. Ordinary standard-source orders retain email consolidation, with
guests kept by order. The merge deduplicates by order ID and keeps distinct
Oxygen orders even when customer email matches. The badge counts displayed
queue entries, not unique customers.

Visible order conflicts downgrade active categories to `needs_review`: missing
or nonpositive amount, non-NGN currency, missing customer, non-unpaid or
cancelled state, or changed payment method. Customer-action rows additionally
require the candidate customer binding to match the current order. Runtime
checks remain authoritative when a customer resumes. The tenth migration
applies the same order eligibility rules before assigning active/review capacity;
client checks also remain necessary for changes between the two reads.
BNPL-pending, failed and expired payment outcomes retain immediate review
coverage across provenance; pending/unpaid manual orders without a workflow
remain excluded.

## Capacity and display ordering

SQL alternates urgent and routine ranks before applying its 250-row cap. This
shares admission capacity. Within routine capacity, active and review-only rows
also alternate so a manual-failure backlog cannot hide every active case. Spare
capacity is available to the remaining groups. Clients need not display RPC
rows in that order.
The app merges both sources by order ID, sorts by activity, and groups
`needs_review` entries first. Other entries remain in their date groups.

The standard source fetches 251 raw orders, retains the newest 250 and detects
an extra row before email consolidation. The RPC returns at most 250
candidates, so exactly 250 is conservatively treated as potentially limited.
A limit notice explains that more follow-ups may be available; Retry is not
shown solely because the source reached its cap.

Errors, invalid rows and missing order details are reported separately through
the existing partial-load warning and Retry action, while usable entries
remain visible. A failed load can coexist with a limit notice. Search-filtered
empty results retain those notices. Consolidation can make a limited result
look short. The combined list has at most 500 entries before deduplication.

Both persisted query keys are versioned for the new metadata. Callers still
receive an array through each hook's `data` property.

## Rollout and contacts

Apply all ten follow-up migrations in timestamp order, starting with
`20261117185800_oxygen_follow_up_index_retry.sql` and ending with
`20261118154500_oxygen_follow_up_eligibility_capacity.sql`, before shipping the app.
An older RPC without customer binding fails safely to review-only rather than
treating an unknown binding as permission to recommend customer continuation.

WhatsApp requires an explicit international prefix (`+` or `00`) and plausible
E.164 digits. Raw order phone values do not establish a country code. National
numbers retain their original call dialing form without an invented prefix;
short, overlong and unusable values hide the corresponding contact action.
