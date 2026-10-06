import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const functionNames = [
  'private.claim_variant_inventory_units_for_order_item_internal',
  'public.claim_variant_inventory_units_for_order_item',
  'private.confirm_order_inventory_reservations',
  'public.confirm_order_inventory_reservations',
];

function migrationFileNames(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

function identifierPattern(name) {
  return name
    .split('.')
    .map((part) => `(?:${part}|"${part}")`)
    .join('\\s*\\.\\s*');
}

function functionMarkerPattern(name) {
  return new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifierPattern(name)}\\s*\\(`,
    'i'
  );
}

function extractFunctionStatement(source, name, markerIndex) {
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifierPattern(name)}\\s*\\(`,
    'i'
  );
  const normalized = serializedInventorySqlParser.stripSqlComments(source);
  const start = markerIndex ?? normalized.search(pattern);
  if (start < 0) throw new Error(`missing fixture function ${name}`);
  const opening = /\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(
    normalized.slice(start)
  );
  if (!opening) throw new Error(`missing fixture function body ${name}`);
  const bodyStart = start + opening.index + opening[0].length;
  const closing = serializedInventorySqlParser.findDollarQuoteEnd(
    normalized,
    bodyStart,
    opening[1]
  );
  if (!closing) throw new Error(`unterminated fixture function ${name}`);
  const end = normalized.indexOf(';', closing.index);
  if (end < 0) throw new Error(`missing fixture function terminator ${name}`);
  return normalized.slice(start, end + 1).trim();
}

function latestFunctionStatement(repoRoot, name) {
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  let latest;
  const pattern = functionMarkerPattern(name);
  for (const fileName of migrationFileNames(migrationsDir)) {
    const source = serializedInventorySqlParser.stripSqlComments(
      fs.readFileSync(path.join(migrationsDir, fileName), 'utf8')
    );
    for (const {
      index,
      text,
    } of serializedInventorySqlParser.splitSqlStatements(source)) {
      const leading = text.search(/\S/);
      if (leading < 0 || !pattern.test(text.slice(leading))) continue;
      latest = extractFunctionStatement(source, name, index + leading);
    }
  }
  if (!latest) throw new Error(`missing fixture function ${name}`);
  return latest;
}

function fixtureFunctionSql(repoRoot) {
  return functionNames
    .map((name) => latestFunctionStatement(repoRoot, name))
    .join('\n\n');
}

export const serializedInventoryFixtureFunctions = { fixtureFunctionSql };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.argv[2];
  if (!repoRoot) throw new Error('repo root argument is required');
  process.stdout.write(`${fixtureFunctionSql(repoRoot)}\n`);
}
