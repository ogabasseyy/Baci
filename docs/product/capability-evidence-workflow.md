# Baci capability evidence

The public feature page is a summary, not the complete product contract. A missing
feature on that page must never be interpreted as a missing implementation.

`baci-capabilities.json` is the reviewed, revision-bound input for Baci writers.
It covers web and mobile-admin workflows, not just marketing cards. It contains
no customer records, credentials or production secrets.

## Evidence levels

- `code_evidenced`: exact source workflow exists at the recorded revision. It is
  not proof of deployment, merchant entitlement, provider activation or success.
- `production_verified`: requires dated production evidence in the record,
  including deployed revision, relevant entitlement/configuration and an observed
  merchant workflow. Never promote a record based only on tests or a filename.
- `unverified`: investigation is incomplete. Do not translate this into “absent”.

The register currently has **no production-verified records**. Public capability
copy should describe supported/configurable workflows with their limitations,
not imply every merchant can access every integration by default.

## Maintenance and writer handoff

1. Review committed source across web, mobile-admin and backend. Keep dirty
   working-tree observations separate from the source revision.
2. Verify routes, permission and entitlement checks, provider requirements and
   platform differences. Domain connection and paid registration are distinct;
   Android purchase restrictions must remain visible.
3. Update the register and date only after reviewing those paths. Resolve price
   and tier claims against actual billing contracts, not unrelated flag metadata.
   A rebase or main advance that touches any cited `source_refs` path invalidates
   the register binding: re-review the affected claims and record the new
   `source_revision`/`reviewed_at` instead of carrying the old binding forward.
   The enforceable binding is the register's `evidence_digest`: a SHA256 over
   every cited `source_refs` path, its content hash, and the register's own
   claim text, recomputed by the
   binding test (`evidence_digest_for` in
   `vps-workers/baci-editorial-context/test_platform_capabilities.py`). Any
   cited-file content change — on a branch, on main, or through a squash
   merge — fails the check until the claims are re-reviewed and the digest is
   regenerated. `source_revision` records the reviewed tree for provenance;
   it is not itself the enforcement mechanism.
4. Copy the reviewed register to the VPS writer's
   `data/baci-platform-research/capabilities.json`. The prompt records its SHA256,
   source revision and review date; after 14 days it is treated as stale.
5. Capture current competitor official sources separately. Internal Baci evidence
   is first-party evidence, not independent competitor research.
6. Correct feature documentation, agent-facing text and comparison drafts together.
   Keep public source links public; do not expose internal file paths as citations.
7. Retain human approval and immutable publisher receipts. A new claim requires
   fresh editorial review; never mutate an already-approved release payload.

## Repository mapping

Use local, scoped Repomix evidence packs to assist source review. Pin the tool
version, explicitly include relevant source/test directories, exclude `.env*`,
credentials, customer exports, generated assets and dependency/build folders,
and inspect the result before giving it to a writer. Secret scanning is a defense,
not permission to export the whole repository.

A compact map helps find code; it does not establish production availability.
Index locally rather than adding memory-heavy graph indexing to the nearly-full
VPS. Do not let mapping tools overwrite `.ruler`-generated agent instructions.

## Open reconciliation

The public pricing cards use Free/Pro/Premium while feature flags include
free/starter/pro/business/enterprise. Do not change prices, assign paid access or
claim “all features” until the billing source and entitlement consumers agree.
API/wholesale/digital-delivery marketing claims also need their exact end-to-end
implementation verified before being expanded.
