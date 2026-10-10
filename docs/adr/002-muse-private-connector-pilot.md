# ADR 002: Private Custom Connector for the Muse Pilot

Date: 1 October 2026. Status: Accepted for the completed private pilot.

The subsequent owner-authorized read-only production/directory rollout is
recorded in ADR-003 and the release status. Its self-service cohort is merchant
owners; the invited-only restriction below describes the earlier private pilot.
It grants no staff access or store-data write operations.

## Context

Baci plans a Muse integration for store intelligence and safe operations
(see `docs/connectors/muse-r0-design.md`). Meta offers two routes: directory
distribution (Meta submission, functional/security/legal review, end-to-end
testing) and private custom connectors (user-created, unreviewed by Meta,
credentials in Muse's Secure Credentials Store).

## Decision

Use a **private custom connector** for the pilot. Baci remains the system of
record, event owner, and authorization enforcer; Muse is the conversational
orchestration layer. Scheduled orchestration remains conditional on pilot
evidence, with the Baci-owned fallback as the default.

## Rationale

- Public evidence (Meta Help Center, vendor connector reports) confirms the
  custom-connector route works without directory review, which matches an
  authorization-first pilot.
- Directory review is premature while the connector contract, RLS entry
  path, and approval-proof design are still being proven.
- Baci-owned approval proof is required regardless (no verifiable
  operation-specific approval API is publicly documented).

## Consequences

- Pilot cohort is limited to invited merchants; no directory discoverability.
- Directory distribution is a later commercialization decision requiring:
  stable tool contract, passing platform/security gates, RLS-entry decision
  implemented, approval-proof gate passed, and Meta review completed.
- All runtime behaviors (auth, refresh, revocation propagation, tool
  discovery, scheduled checks, error taxonomy) must still be proven in the
  exact pilot Muse environment; see `docs/connectors/muse-r0-evidence.md`.
