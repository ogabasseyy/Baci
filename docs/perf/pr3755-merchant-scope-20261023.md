# PR 3755 merchant-scope continuation

## Local change and branch state

Worktree: `/Users/mac/.codex/worktrees/pr3755-merchant-scope/Baci-app`.
Branch: `codex/cold-mobile-header-search`; published head remains
`55ac82509c93321713c6131c7db6e072504a378d`.

Main synchronization is in progress locally. The two conflict markers in the
generated inventory and its assertion are resolved using main's metadata as the
intermediate state. The combined committed source must still regenerate that
snapshot before final submission; no current-source inventory pass is claimed.
No merge commit, push, PR merge or deployment has been performed this round.

The OgaBassey header CSS has moved out of the unconditional tenant-neutral
`StorefrontLcpCopyStyle` into `OgabasseyHeaderCriticalStyle`, rendered by the
OgaBassey template layout before its suspended chrome. Other templates do not
mount it. The shared style now matches main. Publication/tenant guards and cart
commands are untouched by this round.

Two regression tests failed before the fix: absence of navbar rules from the
neutral shell and presence of icon geometry with suspended template chrome.
Both pass with the fix. Existing single-header-owner tests remain green.

## Observed verification

- Local production build: exit 0, source receipt unchanged across the build.
  Public configuration was present; a process-only ephemeral agentic signing
  key satisfies main's local schema requirement. No `.env` file was edited.
- 2,979 affected tests across 528 files pass; the new focused style test also
  passes (1/1). Main's separate builder-auth dependencies were installed using
  the CI command; complete web typecheck then passes.
- Web lint passes with six existing warnings. The OgaBassey directory is
  excluded by repository Biome configuration; changed test formatting there
  used an external formatter config, not a repository gate change.
- Nine cold mobile visits: three each products, iPhone search and smartphones
  category. Fresh contexts, cache disabled, service workers blocked, 412x823
  DPR2 mobile/touch, no input or activation. Every heading remains visible once
  revealed, no route status returns, visible header is sticky with 20px icon,
  and no completed viewport images are broken. Contact sheets were inspected.
- Known local anonymous cart 401 and events 403 remain. These captures are not
  a clean-network claim, performance comparison or field CWV improvement.
- Omnimart and Zorvexa both resolve to their expected storefront titles with
  HTTP 200 and omit header CSS from both raw HTML and mounted styles. Neither
  has an OgaBassey shell. No input, page exceptions or broken viewport images
  were recorded; events 403 remains.
- Omnimart is visibly under-styled before interaction. Do not label the generic
  merchant visual surface healthy. Restoring the exact old header CSS in each
  sampled merchant causes zero differences in the selected computed geometry,
  color, font and box properties across 221/274 elements respectively. This
  isolates omission of that payload from the generic styling problem; it is not
  a complete before/after-main browser comparison.
- Squishyland resolves to Store Not Found and is excluded from acceptance.

## Required review blocker

CodeRabbit's first uncommitted attempt exceeded its 150-file limit because the
main synchronization adds hundreds of files. A scoped attempt was rate-limited;
after its approximately 15-minute window, retry reported a fresh 30-minute
account limit with no assigned organization seat for usage-based review.
No successful review of this round has occurred. Do not bypass that gate.

Remaining: successful scoped local review; commit combined source; regenerate
the inventory and verify its contract; commit/push; verify remote SHA; request
fresh Codex review. No PR merge or deployment is authorized.

## Evidence

Local evidence root:
`/Users/mac/.codex/cwv-lab-builds/20261022-pr3753-release/`.

Key records: `pr3755-scope-red.log`, `pr3755-scope-green.log`,
`pr3755-scope-tests.log`, `merchant-scope-final-build-receipt.json`,
`pr3755-scope-typecheck-final.log`, `scope-other-merchants.json`,
`scope-other-merchants-zorvexa-actual.json`,
`scope-generic-style-comparison.json`, and
`pr3755-scope-coderabbit-routes-final.log`.

Browser artifacts are archived under `browser/merchant-scope-20261023/` in that
evidence root. Raw result video paths refer to their original worktree output
location; the archive retains those directory names.
