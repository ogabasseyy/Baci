import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const functionDefinitions = [
  [
    '20260615181534_serialized_variant_inventory.sql',
    'private.claim_variant_inventory_units_for_order_item_internal',
  ],
  [
    '20260825173500_authorize_serialized_inventory_claims.sql',
    'public.claim_variant_inventory_units_for_order_item',
  ],
  [
    '20260829003000_harden_confirmation_reservation_capture.sql',
    'private.confirm_order_inventory_reservations',
  ],
  [
    '20260825180500_authorize_inventory_confirmation.sql',
    'public.confirm_order_inventory_reservations',
  ],
];

function identifierPattern(name) {
  return name
    .split('.')
    .map((part) => `(?:${part}|"${part}")`)
    .join('\\s*\\.\\s*');
}

function extractFunctionStatement(source, name) {
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifierPattern(name)}\\s*\\(`,
    'i'
  );
  const normalized = serializedInventorySqlParser.stripSqlComments(source);
  const start = normalized.search(pattern);
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

function fixtureFunctionSql(repoRoot) {
  return functionDefinitions
    .map(([fileName, name]) => {
      const source = fs.readFileSync(
        path.join(repoRoot, 'supabase', 'migrations', fileName),
        'utf8'
      );
      return extractFunctionStatement(source, name);
    })
    .join('\n\n');
}

export const serializedInventoryFixtureFunctions = { fixtureFunctionSql };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.argv[2];
  if (!repoRoot) throw new Error('repo root argument is required');
  process.stdout.write(`${fixtureFunctionSql(repoRoot)}\n`);
}
