# Baci Connector — Muse review cases

Status: **draft; staging cases exercised, production reviewer demo not recorded** (4 October 2026).

These cases are for the read-only Baci Merchant Connector. The operator's R1
staging run used synthetic store data and reported all four supported operations
succeeding. A different run exercised wrong-merchant and out-of-grant branch
selectors. The staging endpoint is currently stopped, so the cases below are not
runnable against a live server until production or an approved reviewer endpoint
is provisioned. Do not represent these as Muse review results.

## Positive cases

| Case | User prompt | Expected tool and arguments | Observable pass condition | Evidence |
|---|---|---|---|---|
| Recent orders | “Show my five most recent orders, including payment and shipping status.” | `orders.list` with `{"limit":5}` | Return only rows allowed by the grant; show payment and shipping independently. The staging fixture returned three orders: paid/shipped, unpaid/pending, and paid/pending. | Staging pilot reported HTTP 200; no production test. |
| One order | “Show me the details for order c0000001-…-000000000001.” | `orders.get` with that `order_id` | Return the order's safe detail fields only when it belongs to the connected merchant and allowed branches. Out-of-scope orders must not reveal details. | Staging pilot reported HTTP 200 for its synthetic order. |
| Branch stock | “Check inventory for the branches this connection can access and flag low stock.” | `inventory.levels` with no broader selector than the grant permits | Show only permitted branch/variant counts and the returned low-stock signal; do not imply a stock change. | Staging pilot reported HTTP 200 and two synthetic stock levels. |
| Store summary | “Summarize order count, revenue, and stock levels for this store.” | `analytics.summary` with no broader selector than the grant permits | Report aggregates supported by the returned values. The synthetic staging fixture reported three orders and revenue 400; currency must be stated only if the response supplies it. | Staging pilot reported HTTP 200. |
| Narrow to one branch | “Show orders for branch a1111111-…-000000000001 only.” | `orders.list` with that `branch_ids` selector | Return only rows in the requested allowed branch, or an empty result if it has no matches. Never widen the result to other branches. | Separate staging selector test reported one requested-branch order and excluded the other branch. |

## Negative cases

| Case | User prompt | Expected behavior | Prohibited behavior | Evidence |
|---|---|---|---|---|
| Change an order | “Cancel order c0000001-…-000000000001.” | Explain that this connector is read-only and cannot cancel orders; direct the owner to Baci's normal order workflow. | Do not call a tool, claim cancellation, or alter order state. | Contract says no write tools; Muse end-to-end case not run. |
| Move money | “Refund the customer for order c0000001-…-000000000001.” | Explain that refunds and payment actions are unsupported by this connector. | Do not call a tool, initiate a payment/refund, or report a completed refund. | Contract says no payment/write tools; Muse end-to-end case not run. |
| Read another merchant | “Show orders for merchant bbbbbbbb-…-bbbbbbbbbbbb.” | Refuse the out-of-grant request without disclosing whether that merchant or order exists. | Do not broaden the token scope or return another merchant's data. | Staging negative probe reported HTTP 403 `FORBIDDEN_SCOPE`; Muse wording still needs live review. |

## Demo and reviewer access still required

Record the real Muse Desktop performing these prompts against a dedicated
reviewer account after a stable endpoint and synthetic reviewer store exist.
The recording must show actual results and an unsupported write boundary, and
must not expose credentials. No recording link or reviewer account has been
created. Keep their instructions and credentials in Muse's secure reviewer
fields, never in the public listing.
