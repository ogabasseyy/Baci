# Replay registry

Every pull request that adds a Supabase migration registers it here by adding
**one new folder**. Nothing else is edited, so any number of migration pull
requests can be open at once without conflicting with each other.

The tools discover the folders at runtime:

- `pending-sources.txt` rows feed the history-replay manifest
  (`supabase-history-replay-sources.ts`).
- `expected-pending-sources.txt` rows feed the independent expected inventory
  the manifest is checked against (`expected-pending-sources.test-support.ts`).
- `sql-checks.txt` suites are run by the CI "DB Replay" step
  (`--sql-check-registry apps/web/tools/db/replay-registry`).

## Add a migration

1. Create a folder named `<version>_<slug>`, where `<version>` is the
   14-digit version of your first migration and `<slug>` is lowercase letters,
   digits and underscores. Example: `20261101090000_piggyvest_goal_rename/`.
2. Add `pending-sources.txt` with one row per new migration file: its SHA-256,
   one space, and the file name.
3. Add `expected-pending-sources.txt` with the same rows. It is a deliberate
   second entry: the manifest test fails if the two inventories disagree.

   From the repository root, listing each of your migration files:

   ```sh
   folder=apps/web/tools/db/replay-registry/20261101090000_piggyvest_goal_rename
   mkdir -p "$folder"
   (cd supabase/migrations && shasum -a 256 \
     20261101090000_piggyvest_goal_rename.sql \
     20261101090100_piggyvest_goal_rename_backfill.sql) \
     | sed 's/  / /' > "$folder/pending-sources.txt"
   cp "$folder/pending-sources.txt" "$folder/expected-pending-sources.txt"
   ```

4. Optional: add `sql-checks.txt` listing each SQL suite the DB Replay step
   should run, one repository path per line, for example
   `supabase/tests/piggyvest_goal_rename.sql` or
   `supabase/migrations/tests/piggyvest_goal_rename.sql`. List entry suites
   only, not `.inc.sql` parts they `\ir`-include.

If a migration's bytes change before merge, update its hash in both files of
your folder.

Do **not** edit the shared aggregators, the frozen legacy modules
(`supabase-history-replay-legacy-pending-sources.ts`,
`expected-legacy-pending-sources.test-support.ts`), the
`00000000000000_baseline/` folder, or the `--sql-check` arguments in
`.github/workflows/ci.yml`. `replay-registry-baseline.test.ts` pins the
pre-registry rows and suite order and fails if they change.

## Order

Folders are read in sorted name order. Manifest rows are then sorted by
migration file name, so folder order does not affect them. SQL suites run in
folder order, then in file order, sequentially against one replayed database.
The baseline folder sorts first and keeps the exact order CI used before the
registry existed, so `public_definer_function_exposure.sql` still runs first
and new suites run after it.

## File rules

Each list is plain text that ends with a newline. Lines starting with `#` are
comments, which is the place to record why a suite must run in a given
position. Anything else fails loudly instead of being skipped:

- a folder or file whose name does not match the layout above;
- an empty folder, or a list with no entries;
- a blank line, surrounding whitespace, or a CRLF line ending;
- a source row that is not `<64 lowercase hex> <YYYYMMDDHHMMSS>_<name>.sql`;
- a migration registered twice in the same list;
- a SQL suite that is missing, an `.inc.sql` part, outside
  `supabase/tests/` or `supabase/migrations/tests/`, listed twice, or also
  passed to the replay as an explicit `--sql-check` (it would run twice).

## Check locally

```sh
pnpm --filter @baci/web exec vitest run \
  tools/db/replay-registry.test.ts \
  tools/db/replay-registry-baseline.test.ts \
  tools/db/supabase-history-replay-manifest.test.ts \
  tools/db/supabase-history-replay-sources.test.ts
```

To run the replay with exactly the suites CI runs (needs Docker and the pinned
Supabase toolchain):

```sh
pnpm --filter @baci/web db:replay:chronological \
  --sql-check-registry apps/web/tools/db/replay-registry
```

## Why plain-text folders

The lists are read with synchronous file reads, which behave the same under
vitest, tsx and the CI replay tools. TypeScript modules cannot be discovered
and loaded synchronously in all three, and a generated index file would be one
more shared file for every pull request to edit.
