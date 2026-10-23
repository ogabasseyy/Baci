# Cold mobile header and search follow-up

## Scope and status

This change is local/PR-only. It does not merge, deploy, change tenant guards,
or claim a Core Web Vitals timing improvement.

The header flash has a confirmed delivery cause and a verified local fix.
The intermittent search fallback has a reproduced urgent-restoration failure
mode and a defensive fix, but sole-cause attribution in production remains open.

## Header

Production no-input captures showed a visible `.ogabassey-navbar` with
`position: static` and a 412px search icon, followed by the intended sticky
header and 20px icon. The shared header can reveal before its child route's
eager CSS resource arrives.

`StorefrontLcpCopyStyle`, already in the initial shared shell, now includes the
existing scoped header-critical CSS. It does not load the full stylesheet,
create a second rule implementation, or change the header's final geometry.
The new regression fails without that initial header CSS and passes with it.
The reused header string is 4,822 raw bytes / 1,277 standalone gzip bytes;
this is additional initial-shell CSS, not a claim of a free timing improvement.

## Search

A production visit showed results at 2088ms, the search fallback again at
2556ms, then results at 2653ms, without input or navigation. A separate React
commit capture showed cart restoration immediately before the fallback. That
adjacency alone is not proof of causation.

The real cart provider reproduces a concrete defect: an urgent first-mount
storage restoration replaces already-visible content with its Suspense fallback
when a context consumer suspends. Regressions cover legacy and shared cart
restoration and verify that suspension actually occurred before resolving it.

Only presentation readiness is deferred with `useDeferredValue`. Cart state,
bootstrap generation, persistence, adoption, explicit commands, and subsequent
merchant/session fencing remain immediate. A false readiness/reset still takes
effect immediately. This follows React's documented revealed-content retention
contract: <https://react.dev/reference/react/useDeferredValue>.

Codex correctly rejected the first implementation's deferred `link/start`:
commands could be ignored while the committed generation remained zero. A
failing-first regression now clicks Add-to-Cart while the display is suspended
and checks the item is immediately present and remains after release. The
review correction restores the original urgent lifecycle updates, undoing the
first commit's transition wrapper. The resulting PR has no net lifecycle-module
diff against `origin/main`; only the provider's presentation flag is deferred.
Codex also caught duplicate homepage header CSS; both home shells now emit
footer-only chrome CSS, with a rendered-rule-count regression for each.

Do not describe this as proof that cart restoration was the only production
trigger. A local control did not reproduce the intermittent fallback either.

## Verification

- A fresh local production build completed successfully.
- Raw HTML returned 200 on all three paths; the shared inline resource starts at
  byte 253, before `</head>` and before header markup, with icon sizing present.
- Final repaired-build verification: nine fresh-context mobile visits, products,
  `search?q=iphone`, and smartphones,
  three each. Full Chrome, 412x823, DPR2, touch/mobile emulation, cache disabled,
  service workers blocked, no pointer/key/touch/scroll commands.
- All nine recorded zero input, no sticky activation, foreground visibility,
  scrollY=0, correct final heading, 691px main reserve, and no broken completed
  viewport images. The header was sticky with a 20px icon on every visible
  sampled frame; no search results-to-skeleton return was recorded.
- Videos and first-seven-second contact sheets were inspected for all three
  routes. Passive animation-frame observations continue through the capture,
  not just the settled screenshot.
- Before the Codex corrections, two search visits delayed the unchanged search
  client chunk by 1500ms. Neither arm reproduced the fallback. Those earlier
  diagnostics are not a causal A/B win or final-build clearance.
- Expected unresolved failures remain: anonymous storefront cart returns 401;
  the local same-site proxy's `/api/events` returns 403. No page exceptions were
  recorded. Do not call this a clean network/console run.
- Final affected scope: 713 tests across 134 cart/search/home/CSS suites passed,
  including the new command-during-suspension and duplicate-header regressions.
  App lint passed with six existing warnings.
  App typecheck (including worker and MCP projects) passed after correcting the
  new PostCSS test's ancestor type. CodeRabbit completed with two test-strength
  issues, both addressed. The second CodeRabbit pass raised one documentation
  scope clarification, also addressed.
- A full app-suite attempt was not green and was stopped when review required
  new runtime changes. Its clean-worktree Cloudflare isolation test rejected
  the generated untracked browser evidence, then passed after that evidence
  was archived outside the checkout without changing the gate. A separate
  `smol-toml-integrity.test.ts` scaling check also failed during the broad run,
  then passed its separate two-test rerun. The broad run was interrupted with
  exit 143 for the review repairs; do not claim full-suite clearance.

Evidence is retained outside the submitted diff:

- Worktree: `/Users/mac/.codex/worktrees/cwv-production-release/Baci-app`
- Archived browser records/videos:
  `/Users/mac/.codex/cwv-lab-builds/20261022-pr3753-release/browser/`
  (see `ARCHIVE.md` for original capture-path mapping).
- Controls and delayed-chunk diagnostics are retained alongside the candidate.
- Build/check/diagnostic logs:
  `/Users/mac/.codex/cwv-lab-builds/20261022-pr3753-release/`

These are functional visual checks, not quiet-host LCP benchmarks, field p75
measurements, or production verification of this new branch.
