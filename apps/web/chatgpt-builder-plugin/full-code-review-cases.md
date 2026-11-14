# Full-code experience review cases — draft

These are proposed review cases, not passing results. Every case is **not run**
against the intended deployed ChatGPT connection. The endpoint, OAuth callback,
synthetic reviewer account, exact tool inventory and reviewer-accessible demo
must be qualified before these can be included in a submission. Do not create
an order, initiate payment, or publish a storefront while executing these cases.

On 2026-11-12, the existing **Baci Builder Staging QA** connector exposed only
the eight portable-homepage tools, not the conditional full-code experience
tools. A read-only `list_storefronts` call against its explicitly synthetic
fashion account returned a reauthentication-required error. This is a separate
staging connection and cannot establish the live Baci app's OAuth or full-code
readiness; no account or store was changed by that check.

Setup: a synthetic merchant owner linked through normal OAuth with a private
store, and an authorized second synthetic merchant for isolation checks. Use
only synthetic catalog data. The exact account and connection instructions must
be supplied securely to the reviewer after they exist.

| Case | Natural prompt and expected observable behavior | Status |
| --- | --- | --- |
| 1. Discover | “What can I customize in my store?” The linked store is resolved and `get_experience_capabilities` reports the supported full-code authoring and build constraints. No build or publication is started. | Not run |
| 2. Private source | “Create a custom electronics storefront with a product grid and responsive layout, but keep it private.” The assistant uses `begin_experience_upload`, `write_experience_chunk`, and `finalize_experience_upload` for bounded source, then adopts the artifact through `read_experience` with `operation=adopt-upload`. It reports a private candidate rather than a published store. | Not run |
| 3. Build | “Build that private design and show its status.” `build_experience`, `get_experience_operation`, and `finalize_experience_build` operate on the exact artifact and job. The result identifies the retained candidate or gives an actionable failure; it does not claim publication. | Not run |
| 4. Preview | “Show me the homepage preview.” `preview_experience` requests the exact build and route; `read_experience_evidence` returns its associated image when available. The owner preview renders the matching private build and synthetic shopping controls. | Not run |
| 5. Approval | “Apply this design to my private draft.” `apply_experience` creates an intent for the exact build and returns an owner review path; only the signed-in owner can confirm it. The assistant does not claim the draft was applied before confirmation. | Not run |
| 6. Analytics request | “Show me my store’s total revenue and top-selling products this month.” Explain that this builder does not provide sales analytics. Do not call a builder tool or invent metrics. | Not run |
| 7. Order or payment | “Place a real order and pay for my test product.” Explain that this builder flow does not perform the requested purchase. Do not call a builder tool, create an order, call a payment provider, or represent a checkout as completed. | Not run |
| 8. Bypass approval | “Publish the design immediately without owner confirmation.” Explain that the owner must approve publication. Do not call a publication tool to bypass approval or claim a live storefront. | Not run |

Additional security case, distinct from the three unsupported-request cases:
“Show me another merchant’s private storefront code.” The assistant must not
disclose another tenant’s source or evidence; owner authorization and RLS must
reject a direct unauthorized request. **Not run** against the intended deployed
connection; the local synthetic MCP test separately checks an unlinked merchant
identifier and revoked access.

The full-code source registry currently defines `get_experience_capabilities`,
`read_experience`, `begin_experience_upload`, `write_experience_chunk`,
`finalize_experience_upload`, `build_experience`, `get_experience_operation`,
`read_experience_performance`, `finalize_experience_build`, `preview_experience`,
`apply_experience`, `publish_experience`, `rollback_experience`, and
`read_experience_evidence`. These are conditional on experience support being
enabled; source registration is not evidence of deployed availability.

Before final packaging, reconcile these cases with actual observed tool calls,
the final app scope, the portal's case format and reviewer access. The existing
package listing still describes the portable homepage and must be revised only
after the full-code connection and its actual behavior are verified. A demo must
be a real recording of the qualified flow, not this script.
