import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function compatibilityPlan(source, readMigration) {
  const match =
    /^export const SAVINGS_PENDING_REPLAY_SOURCE_ROWS = `([^`]*)`;\n\nexport const SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = `([^`]*)`;\s*$/.exec(
      source
    );
  if (!match) throw new Error('registry format rejected');
  const rows = [match[1], match[2]].flatMap((sourceRows) =>
    sourceRows ? sourceRows.split('\n') : []
  );
  if (rows.length > 80) throw new Error('bounded replay limit exceeded');
  const versions = new Set();
  const plan = [];
  for (const row of rows.sort()) {
    const parsed = /^([a-f0-9]{64}) (\d{14}_[a-z0-9_]+\.sql)$/.exec(row);
    if (!parsed) throw new Error('invalid registry row');
    const [, hash, name] = parsed;
    const version = name.slice(0, 14);
    if (versions.has(version)) throw new Error('duplicate version');
    versions.add(version);
    const body = await readMigration(name);
    if (createHash('sha256').update(body).digest('hex') !== hash)
      throw new Error(`hash mismatch: ${name}`);
    plan.push({ name, hash, body });
  }
  return plan.sort((left, right) => left.name.localeCompare(right.name));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = process.argv[2];
  if (
    !/^\/tmp\/baci-piggyvest-compat\.[A-Za-z0-9]+\/sql$/.test(destination ?? '')
  )
    throw new Error('owned destination required');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const readMigration = (name) =>
    readFile(resolve(root, 'supabase/migrations', name));
  const registry = await readFile(
    resolve(
      root,
      'apps/web/tools/db/supabase-history-replay-savings-pending-sources.ts'
    ),
    'utf8'
  );
  const base =
    '20260521130000_customer_wallet_dva_and_device_savings_tables.sql';
  const basePlan = await compatibilityPlan(
    `export const SAVINGS_PENDING_REPLAY_SOURCE_ROWS = \`a3a1ed5c5044fd41f03989432177dcb600d76ff97dea2825bab8abc00cb8f52d ${base}\`;`,
    readMigration
  );
  const plan = [
    ...basePlan,
    ...(await compatibilityPlan(registry, readMigration)),
  ];
  await mkdir(destination, { mode: 0o700 });
  for (const entry of plan) {
    await writeFile(resolve(destination, entry.name), entry.body, {
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(`${entry.hash} ${entry.name}\n`);
  }
}
