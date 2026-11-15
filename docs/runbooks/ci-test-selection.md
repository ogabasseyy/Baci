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

## When the plan matters

The planner only chooses between test plans. Whether `quality-test` runs at all
is decided earlier by the `web` path filter in `.github/filters/ci.yml`
(`apps/web/**`, `vercel.json`, shared packages, a few CI files). A pull request
that touches only docs, `.jules` or migrations, with no file in that filter,
runs no web tests before or after this change; the database replay jobs cover
migrations through the `quiz_db` filter. The usual migration pull request also
adds a replay-registry entry under `apps/web/`, which opens the web gate, and
then the migration readers run.

## Which files keep the full suite

The full triggers are listed in `.github/scripts/resolve-ci-test-plan.mjs`; the
other classes live in `.github/scripts/resolve-ci-test-plan-paths.mjs`.

- **Full suite:** CI wiring (`ci.yml`, `.github/actions`, the path filters in
  `.github/filters`, the planner and the Vitest provider), shared packages, any
  `package.json` (at any depth), any Vite or Vitest config, lockfile,
  `tsconfig`, test setup files, mobile admin, any unknown path, deleted source
  files, and every non-PR event. A `package.json` anywhere makes Vitest rerun
  every test, which a targeted plan would run in one unsharded job, so it goes
  to the shards. The path filters list themselves in every job group, so a
  change to them is meant to run every gated job.
- **Targeted:** `apps/web` source, tools and root `*.test.*` / `*.spec.*` files;
  code files in the browser test folders (`tests/checkout-browser`,
  `tests/oxygen-policy-browser`, `tests/oxygen-cookie-harness`,
  `tests/experience-browser`); mobile storefront source and the code files in
  `__tests__`. Fixtures there (text, JSON, HTML, snapshots) keep
  the full suite because import-following cannot see them. The other
  `apps/web/tests` folders keep it too: several are excluded from the default
  Vitest run (`exclude` in `vitest.config.ts`) and run through their own
  scripts. Storefront `config/` also keeps it: its `*.test.mjs` suites only run
  through the package `test` script (`node --test`), which Jest skips, and
  `__mocks__` too: Jest wires those files through its config, which
  `--changedSince` cannot map back to tests.
- **Files that tests read through fs** (migrations, SQL tests, the replay
  registry, docs, workflows other than `ci.yml`, `vps-workers`, markdown,
  `.jules`, `.ruler`, `vercel.json`): targeted too, with the
  readers added by the Vitest provider below, unless a test outside `apps/web`
  names the changed file (next section).

One full trigger or one unknown path in a diff keeps the whole suite. So does a
mobile storefront change next to a file that tests read: the provider feeds
Vitest only, and Jest's `--changedSince` cannot follow fs reads (for example a
storefront test that reads a release workflow), so only the full path runs the
whole storefront test script.

A fixture in the folders that were always targeted by prefix (a JSON, CSS or
snapshot file under `apps/web/src`, `tools`, `mcp-server`, `experience-runtime`
or the eight mobile storefront source folders) is invisible to `vitest
--changed` and Jest, and no reader family covers it. A diff made only of files
in those folders stays targeted, as it was before the reader families. Next to
any file outside them (docs, a migration, a workflow, a browser test, a root
test) the planner keeps the full suite, which is what the previous planner ran
for those diffs (`keepsFullForSourceData`). Markdown and the replay registry
are reader files, not fixtures. A reader family for these fixtures would let
those diffs leave the full suite; it needs its own measurements.

## Tests outside apps/web

The provider only reaches tests in `apps/web`. The tests of the mobile apps and
of the packages run only on the full affected path, so the planner searches
`apps/mobile-admin`, `apps/mobile-storefront` and `packages/*` itself
(`resolve-ci-test-plan-readers.mjs`) for a test that names a changed data file,
by its path or by its bare name next to a quote or separator. Any hit keeps the
full suite and the reason names the test. A mention of the file's folder does
not count: those tests read specific old migrations or workflows, and nobody
outside `apps/web` lists a data folder today. A contract test fails if one
starts to. If the search itself fails, the plan is the full suite.

## The Vitest provider

`vitest --changed` follows imports only, so it cannot know that a test reads
`supabase/migrations`. `.github/scripts/vitest-changed-files-provider.mjs` is
wired in `apps/web/vitest.config.ts` as `test.experimental.vcsProvider`. It
returns Vitest's usual changed files and, when a changed file belongs to the
families above, also every test or helper whose source names that file or its
folder. The check is deliberately generous: an extra test is cheap, a missed
one is not. A bare file name such as `config.toml` only matches
when a path separator or a quote sits right before it. If the config cannot find the provider file (sparse checkout),
Vitest falls back to its own git provider.

Limits (what it cannot find):

- a test that builds the path without ever writing it as a literal; write the
  path as a literal, or keep it in a helper that does;
- a non-test module that neither imports `fs` (or a glob library), builds paths
  (`node:path`, `__dirname`, `process.cwd()`) nor holds the path as a quoted
  literal; a helper that only exports `'supabase/migrations'` or
  `join(ROOT, 'supabase', 'migrations')` does count, a path inside a sentence or
  a comment does not;
- readers written in shell, Python or SQL runners: they are not Vitest tests, so
  their own CI jobs (selected by the `quiz_db`, `deploy_scripts` and similar
  filters) run them.

Test files too large to search (over 1.5 MB) are assumed to be readers. Any
other module over that size is skipped and named in the log: the realistic case
is a generated types file, which reads nothing (the largest source file today is
`apps/web/src/types/supabase.ts`, about 0.7 MB, and none is over the cap).
`docs/` has no job behind it (migrations have the DB replay jobs, `vps-workers`
its own tests), so for docs the name match is the only safety net.

Playwright specs are never run by Vitest. Those under `tests/checkout-browser`,
`tests/oxygen-policy-browser` and `tests/oxygen-cookie-harness` run in
`checkout-browser.yml` on every pull request (a contract test pins that), so
they are targeted. A Playwright spec anywhere else is unknown and keeps the full
suite. `tests/experience-browser` has no pull request workflow; its code files
were already targeted-only before this change (its fixtures now keep the full
suite).

## Deleted files

The planner lists deleted files and both sides of a rename (`git diff
--name-only --no-renames`, no `--diff-filter`). Deleting or renaming away a
source file keeps the full suite: an unchanged test may still import it, and
neither `vitest --changed` nor Jest can select that test because the import no
longer resolves; the same goes for a fixture deleted next to the code in a
targeted folder. Deleting a test, or a file of the reader families (a doc, a
migration, a workflow, a registry entry), does not: nothing imports a test, and
the provider finds the readers of such a file by name. If git fails while the
deleted files are listed, the plan is the full suite (an unreadable list must not
read as "no deletions").

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
