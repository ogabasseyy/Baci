# How CI chooses which web tests run on a pull request

The full web suite is 6 parallel jobs and about 100 job-minutes. Most pull
requests do not need all of it before merge, so a small planner decides.

## Who decides

`.github/scripts/resolve-ci-test-plan.mjs` runs in the `changes` job and again in
`quality-test`. It reads the list of changed files and returns one mode:

| Mode | What `ci.yml` runs |
|---|---|
| `full-affected` | the 6 web shards, plus Turbo tests for the changed non-web packages |
| `targeted-web-vitest` | `vitest run --changed`, plus two fixture-boundary tests |
| `targeted-storefront-jest` | `jest --changedSince` for the mobile storefront |
| `targeted-web-and-storefront-tests` | both of the above |
| `config-smoke` | planner tests only (Turbo env additions) |

`ci.yml` hard-codes what each mode runs and ignores the planner's `command`.
Never add a mode without adding its branch to the `Run Tests` step first: an
unknown mode falls through to the non-web path and web tests would not run at
all. A contract test (`resolve-ci-test-plan-contract.test.mjs`) fails if you do.

## Which files keep the full suite

The full triggers are listed in `.github/scripts/resolve-ci-test-plan.mjs`; the
other classes live in `.github/scripts/resolve-ci-test-plan-paths.mjs`.

- **Full suite:** CI wiring (`ci.yml`, `.github/actions`, the planner and the
  Vitest provider), shared packages, `package.json`, lockfile, `tsconfig`,
  test setup files, mobile admin, any unknown path, and every non-PR event.
- **Targeted:** `apps/web` source, tools, tests and root test files; mobile
  storefront source, `__tests__`, `__mocks__` and `config`.
- **Files that tests read through fs** (migrations, SQL tests, the replay
  registry, docs, workflows other than `ci.yml`, `vps-workers`, markdown,
  `.jules`, `.ruler`, `vercel.json`, Playwright specs): targeted too, with the
  readers added by the Vitest provider below.

One full trigger or one unknown path in a diff keeps the whole suite.

## The Vitest provider

`vitest --changed` follows imports only, so it cannot know that a test reads
`supabase/migrations`. `.github/scripts/vitest-changed-files-provider.mjs` is
wired in `apps/web/vitest.config.ts` as `test.experimental.vcsProvider`. It
returns Vitest's usual changed files and, when a changed file belongs to the
families above, also every test or helper whose source names that file or its
folder. The check is deliberately generous: an extra test is cheap, a missed
one is not. If the config cannot find the provider file (sparse checkout),
Vitest falls back to its own git provider.

Limits: a test that builds a path without ever writing it as a literal is not
found. Write the path as a literal, or keep it in a helper that does.

## Deleted files

The planner lists deleted files and both sides of a rename (`git diff
--no-renames`, no `--diff-filter`), so removing a shared file next to a web
edit still runs the full suite.

## Changing this

- New kind of data file read by tests: add a family to `FS_READER_FAMILIES`
  and a test in `resolve-ci-test-plan-paths.test.mjs`.
- Upgrading Vitest: `experimental.vcsProvider` is experimental. The contract
  test fails if the new version drops it; replace the provider before upgrading.
- Keep file-name lists in the planner file itself. The storefront release gate
  (`storefront-release-gate-references.mjs`) follows script file names out of
  `ci.yml` at most 6 hops and fails the `changes` job beyond that; moving the
  lists into another module pushed an existing chain over the limit.
- Local check:
  `node --test .github/scripts/resolve-ci-test-plan.test.mjs .github/scripts/resolve-ci-test-plan-config.test.mjs`
