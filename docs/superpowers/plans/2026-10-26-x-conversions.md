# X conversion implementation

1. Add failing regression/contract tests for merchant event-code mapping, send-time consent, tenant replacement, forbidden client purchase, paid payload, OAuth signing and processed-count receipts.
2. Implement public bounded event map, browser SDK client, persistent mount and funnel wiring; coordinate shared plumbing with the TikTok/Snapchat branch.
3. Add append-only owner-RLS settings/secret storage migration and protected settings endpoint/dashboard. Public status includes only credential presence. Extend only bounded public event-code projections.
4. Add X to durable paid routing and database destination constraints; hydrate confirmed paid orders, gate marketing consent, sign server requests and preserve delivery-unknown semantics. Capture marketing consent at checkout without changing Meta/GA4 consent behavior.
5. Run red/green focused tests, SQL isolation/tenant/no-secret checks, typecheck and normal hooks. Refresh immutable/source inventory receipts as required. Skip CodeRabbit per user; push PR, attach it, obtain current-head Codex review and CI. Parent serializes merge/deployment/provider tests.
