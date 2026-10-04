import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function planReplay(source, readMigration) {
  const match =
    /^export const SAVINGS_PENDING_REPLAY_SOURCE_ROWS = `([^`]*)`;\n\nexport const SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = `([^`]*)`;\s*$/.exec(
      source
    );
  if (!match) throw new Error('registry format rejected');
  const versions = new Set();
  const entries = [match[1], match[2]]
    .flatMap((rows) => (rows ? rows.split('\n') : []))
    .map((row) => {
      const parsed = /^([a-f0-9]{64}) (\d{14}_[a-z0-9_]+\.sql)$/.exec(row);
      if (!parsed) throw new Error('invalid registry row');
      const [, hash, name] = parsed;
      const version = name.slice(0, 14);
      if (versions.has(version)) throw new Error('duplicate migration version');
      versions.add(version);
      return { hash, name };
    })
    .filter(
      ({ name }) =>
        /_(piggyvest|goal_policy)_/.test(name) ||
        /^\d{14}_purchase_current_recovery(?:_|\.sql$)/.test(name) ||
        /^\d{14}_collection_reconciliation(?:_|\.sql$)/.test(name) ||
        /^\d{14}_draft_closure(?:_|\.sql$)/.test(name) ||
        /^\d{14}_device_change(?:_|\.sql$)/.test(name) ||
        /^\d{14}_protected_offer(?:_|\.sql$)/.test(name) ||
        /^\d{14}_(payment_leg_recovery|period_attribution_recovery|reconciliation_cases)(?:_|\.sql$)/.test(
          name
        ) ||
        /^\d{14}_(goal_lifecycle|cancel_plan|cancellation_recovery|purchase_preparation|purchase_pricing|schedule_proposal|customer_funding)_/.test(
          name
        )
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!entries.length) throw new Error('empty staging scope');
  for (const entry of entries) {
    entry.body = await readMigration(entry.name);
    if (createHash('sha256').update(entry.body).digest('hex') !== entry.hash) {
      throw new Error(`hash mismatch: ${entry.name}`);
    }
  }
  return entries;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = process.argv[2];
  if (
    !/^\/tmp\/baci-piggyvest-full\.[A-Za-z0-9]+\/migrations$/.test(
      destination ?? ''
    )
  ) {
    throw new Error('owned disposable destination required');
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const source = await readFile(
    resolve(
      root,
      'apps/web/tools/db/supabase-history-replay-savings-pending-sources.ts'
    ),
    'utf8'
  );
  const plan = await planReplay(source, (name) =>
    readFile(resolve(root, 'supabase/migrations', name))
  );
  await mkdir(destination, { mode: 0o700 });
  for (const entry of plan) {
    await writeFile(resolve(destination, entry.name), entry.body, {
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(`${entry.hash} ${entry.name}\n`);
  }
}
