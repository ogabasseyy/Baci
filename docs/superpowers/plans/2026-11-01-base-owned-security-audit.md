# Base-Owned Security Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing SARIF exemption drift audit independently executable from base-owned workflow code for every PR.

**Architecture:** A base-owned `pull_request_target` workflow invokes only base-owned scripts. It fetches immutable PR base and head objects, materializes audited head blobs as inert files in an isolated disposable directory, computes trusted-path changes from both sides of the diff, and runs the base auditor with fail-closed inputs. Fork SAST is a separate deliverable: it needs an independently isolated scanner and must never receive privileged credentials alongside executable PR content.

**Tech Stack:** GitHub Actions, Python, Git, existing SARIF auditor and shell fixtures.

**Spec:** GitHub issues #3599 and #3621. Fork scanning #3624 is deliberately separate.

## Global Constraints

- The privileged base-owned audit never executes PR code or PR-owned actions, hooks, packages, Python modules, or configuration. Its separate ordinary `pull_request` selftest runs candidate test code only with a read-only token and no secrets or caches.
- Use immutable event SHAs; require the event base to be an ancestor of the head, fail closed on fetch or comparison errors, and inspect old and new paths for trusted changes. Branch protection must require this check and up-to-date branches (or an equivalent current-base merge-queue re-audit); a base advance does not rerun a PR-target workflow by itself.
- Reject symlinks, submodules, special paths, malformed trees, excessive input sizes, and output-file collisions.
- Keep credentials, trusted code, and generated output outside the staged head tree. Use minimal read permissions and no caches.
- This workflow is not an enforced replacement until the owner separately configures the required status check and Actions event policy.

## Task 1: Inert PR audit snapshot

Files: new `.github/scripts/base-owned-audit-snapshot.py` and colocated focused tests.

- [ ] Write failing disposable-Git tests for safe blob staging, immutable SHAs, trusted rename/deletion, symlink rejection, and size caps.
- [ ] Implement strict object-only staging and byte-safe trusted-change detection; never use the head working tree or external diff helpers.
- [ ] Verify malicious fixtures fail and ordinary PR fixtures pass, including missing base/head objects.

## Task 2: Base-owned workflow invocation

Files: new workflow and focused workflow-contract tests.

- [ ] Write failing tests requiring base-owned script paths, non-privileged token permissions, immutable event refs, no head execution, and fail-closed behavior.
- [ ] Run the existing base auditor on the staged tree with independently derived change signal, no PR-provided SARIF/output paths, and sanitized environment.
- [ ] Exercise benign and hostile fixtures, then run the nearest existing auditor tests and scoped required checks.
- [ ] Review the candidate independently for bypass and compatibility, address confirmed findings, and rerun verification.

## Task 3: Enforcement handoff

- [ ] Document required-check and event-policy prerequisites and the remaining fork SAST gap. Do not change repository settings without separate authorization.
- [ ] Request exact-head review, address valid comments, and verify CI before merge eligibility.

## Execution record

- Snapshot regression suite: 10 tests pass, including an actual base auditor run against benign and deliberately weakened workflow inputs, stale bases, output bounds, symlinks, submodules, and output collisions.
- Workflow contract test, Python compilation, and actionlint pass. The current protected web lint/typecheck tasks pass from cache.
- Independent review identified stale-base risk; the helper now requires the event base to be an ancestor of the head, with strict required branch protection documented as a separate enforcement prerequisite.
- Ruling: the never-execute-PR-code constraint applies to the privileged base-owned audit. A separate normal `pull_request` selftest runs candidate tests with a read-only token, no secrets, and no caches, consistent with existing unprivileged CI.
- No settings were changed. Live `pull_request_target` behavior, required-check rollout, and fork SAST remain unverified or incomplete; this work must not close the related issues on its own.
