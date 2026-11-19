# Review and rollout plan (not executed)

1. Finish the current-main production preview and cold browser matrix. Keep native reference-host measurements separate from full Next-host diagnostics. Preserve all failed and contaminated samples. Resolve unexplained mobile shifts before declaring the storefront release-ready.
2. Resolve valid current-source review findings. Re-run affected checks after fixes and bind review receipts to the final source hashes. The existing free review authorization does not authorize paid fallbacks.
3. Prepare a task-only PR after explicit authorization to publish repository changes. Include the inherited Experience integration, current-main saved-cart reconciliation, normal-RLS contracts, performance policy and operational limits. Obtain the required current-head review and CI; local tests do not replace those gates.
4. Before a pilot, separately authorize infrastructure and deployment. Configure persistent report signing/storage and the isolated browser runner. A missing signing store or unavailable runner must produce not-measured, not qualification success. Do not use service-role credentials in commerce or owner flows.
5. Use a synthetic merchant pilot first. Verify build, private preview, source/data invalidation, revocation, native commerce and recovery. Order/payment tests need separate scope; they are excluded here. Production release must follow the approved prebuilt VPS flow and requires separate authorization.
6. Roll back using the existing native storefront recovery path and owner-authorized mode exit. Test mode exit and stale evidence rejection locally; retain immutable historical reports. Do not weaken auth, remove RLS, bypass the performance gate, or silently reinstate stale custom artifacts to recover availability.
7. Monitor real field LCP/CLS/INP after an authorized pilot. A two-second local reference target is a development gate, not a universal CWV promise. Changes to code, catalog, fonts, images and third-party scripts require new qualification and operational observation.

Nothing in this plan publishes, merges, deploys, creates orders or charges a payment.
