# Full-code experience review cases — draft

These are proposed review cases, not passing results. Every case is **not run**
against the intended deployed ChatGPT connection. The endpoint, OAuth callback,
synthetic reviewer account, exact tool inventory and reviewer-accessible demo
must be qualified before these can be included in a submission. Do not create
an order, initiate payment, or publish a storefront while executing these cases.
The positive review flow ends with the private-draft approval request
(`apply_experience`). The draft OAuth client requests `storefront.read` and
`storefront.write`. Publication and rollback require separate
`storefront.publish` consent and are outside this review flow.

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
| 1. New account | “Create a private electronics store for my new Baci account and show what I can customize.” Start with a fresh synthetic Baci account, no merchant store, and explicit create-store consent in the OAuth connection. Choose a unique synthetic slug and electronics business type; do not use a real merchant account. Expected tools: `create_storefront_draft, get_experience_capabilities`. Create one owned private store using the supplied business name, country, unique slug and a stable retry key. Read capabilities for that exact linked store. Reconcile an uncertain creation with the same retry key; do not create duplicate stores, invoke Baci AI, or claim publication. | Not run |
| 2. Custom source and build | “Create a custom electronics storefront with a product grid and responsive layout, but keep it private.” Continue from the newly created private synthetic store. Upload a custom product-grid design and build it without publication. Expected tools: `begin_experience_upload, write_experience_chunk, finalize_experience_upload, read_experience (operation=adopt-upload), build_experience, get_experience_operation, finalize_experience_build`. Use bounded source upload and exact-version adoption, then build that immutable artifact. Report queued/running status until the exact job confirms completion. Reconcile timeouts using the same job, and identify the private candidate without claiming it is live. | Not run |
| 3. Edit and rebuild | “Change the hero heading to Orbit QA Collection, keep the product cards, and rebuild the private preview.” Continue from the successfully built source in case 2. Change only the hero heading to Orbit QA Collection while retaining the product cards and responsive layout. Expected tools: `read_experience, build_experience, get_experience_operation, finalize_experience_build`. Read and patch the expected source revision, then build the updated artifact. The new private build preserves the product cards and contains the requested heading. Do not silently overwrite a conflicting revision or claim publication. | Not run |
| 4. Private preview | “Show me the homepage preview.” Continue with a successfully built private synthetic storefront. Expected tools: `preview_experience, read_experience_evidence`. Request the exact build and homepage route, show the matching private preview and cite associated evidence when available. | Not run |
| 5. Approval | “Apply this design to my private draft.” Continue with a built candidate and a signed-in synthetic owner able to review the intent. Expected tools: `apply_experience`. Request an intent bound to the exact build and provide the owner review path; do not claim application occurred before owner confirmation. | Not run |
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
the final app scope, the portal's case format and reviewer access. The package and saved portal listing describe full-code authoring; neither
listing is evidence of live availability. The structured draft cases now include
fresh-account store creation, custom source/build, an exact-version edit, private
preview and owner approval. Reconcile these with observed results before upload. A demo must
be a real recording of the qualified flow, not this script.

## Saved portal inspection — 15 November 2026

The existing Baci Website Builder 0.1.0 remains not submitted and not published.
The listing describes React/TypeScript/CSS, private builds and owner approval.
Its MCP configuration still points to `https://mcp.usebaci.com/builder/mcp`,
reports authentication unavailable, and has no discovered tools. Domain
verification is complete. Reconnect only after the intended direct endpoint is
qualified; no reconnect or upload was performed during this inspection.

Countries currently show **All supported countries** and no translations.
Five positive case slots are populated: fresh-account store creation, source
build, source edit/rebuild, preview and owner approval. Slots 2–5 have vague
scenario text; the structured draft improves that setup without claiming the
cases passed. The current saved release note describes full-code authoring,
private builds/previews and owner approval. The video walkthrough URL is empty
and required. The privacy assessment is a non-blocking automated-assessment
failure, not confirmation that the policy covers this builder. Secure reviewer
access and negative-case details were not verified in this inspection.

The portal metadata was read only. Preserve its saved fields on any later ZIP
replacement and verify them again after upload.
