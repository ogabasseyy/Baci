import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

function migrationFileNames() {
  return fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}
const migrationSources = migrationFileNames().map((fileName) =>
  fs.readFileSync(path.join(migrationsDir, fileName), 'utf8')
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const stripSqlComments = (source) =>
  source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
function functionMarkerPattern(functionName, flags = 'i') {
  const name = functionName.replace(/\($/, '');
  return new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${escapeRegex(name)}\\s*\\(`,
    flags
  );
}
function functionDropPattern(functionName, flags = 'i') {
  const name = functionName.replace(/\($/, '');
  return new RegExp(
    `DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${escapeRegex(name)}(?:\\s*\\([^;]*\\))?\\s*(?:CASCADE|RESTRICT)?\\s*;`,
    flags
  );
}
function functionBody(source, functionName) {
  const markerMatches = [
    ...source.matchAll(functionMarkerPattern(functionName, 'gi')),
  ];
  const start = markerMatches.at(-1)?.index ?? -1;
  assert.notEqual(start, -1, `missing ${functionName}`);

  const opening = /\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(
    source.slice(start)
  );
  assert.ok(opening, `missing dollar-quote opener for ${functionName}`);

  const bodyStart = start + opening.index + opening[0].length;
  const delimiter = escapeRegex(opening[1]);
  const closing = new RegExp(
    `\\r?\\n[\\t ]*${delimiter}[\\t ]*[^\\r\\n;]*;`,
    'i'
  ).exec(source.slice(bodyStart));
  assert.ok(closing, `unterminated ${functionName}`);
  return source.slice(start, bodyStart + closing.index);
}
function latestFunctionBody(functionName, sources = migrationSources) {
  let latestBody;

  for (const rawSource of sources) {
    const source = stripSqlComments(rawSource);
    const create = [
      ...source.matchAll(functionMarkerPattern(functionName, 'gi')),
    ].at(-1);
    const drop = [
      ...source.matchAll(functionDropPattern(functionName, 'gi')),
    ].at(-1);
    if (drop && (!create || drop.index > create.index)) {
      latestBody = undefined;
    } else if (create) {
      latestBody = functionBody(source, functionName);
    }
  }

  assert.ok(latestBody, `missing ${functionName} in migrations`);
  return latestBody;
}
function extractIfBranches(source, openingPattern) {
  const lines = source.split(/\r?\n/);
  const openingIndex = lines.findIndex((line) => openingPattern.test(line));
  assert.notEqual(openingIndex, -1, 'missing target IF branch');

  let depth = 1;
  let inElse = false;
  const thenLines = [];
  const elseLines = [];

  for (const line of lines.slice(openingIndex + 1)) {
    if (/^\s*IF\b/i.test(line)) {
      depth += 1;
    } else if (/^\s*END\s+IF\b/i.test(line)) {
      depth -= 1;
      if (depth === 0) {
        assert.ok(inElse, 'target IF branch is missing ELSE');
        return {
          thenBranch: thenLines.join('\n'),
          elseBranch: elseLines.join('\n'),
        };
      }
    } else if (depth === 1 && /^\s*ELSE\b/i.test(line)) {
      inElse = true;
      continue;
    }

    (inElse ? elseLines : thenLines).push(line);
  }

  assert.fail('unterminated target IF branch');
}
function legacyDecrementMatches(source) {
  const stockDecrement =
    /\bstock_quantity\s*=\s*(?:GREATEST\s*\(\s*)?(?:\(\s*)*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*stock_rec\s*\.\s*total_quantity\b(?:\s*\))*\s*(?:,\s*0\s*)?(?:\s*\))*/i;
  return [
    ...stripSqlComments(source).matchAll(
      /UPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?(product_variants|products)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\b([\s\S]*?);/gi
    ),
  ].filter(([, , statement]) => stockDecrement.test(statement));
}
function maskNestedSql(source) {
  let depth = 0;
  let quote;
  let masked = '';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      masked += ' ';
      if (char === quote) {
        if (source[index + 1] === quote) {
          masked += ' ';
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      masked += ' ';
    } else if (char === '(') {
      depth += 1;
      masked += ' ';
    } else if (char === ')') {
      depth = Math.max(depth - 1, 0);
      masked += ' ';
    } else {
      masked += depth === 0 ? char : ' ';
    }
  }
  return masked;
}
function legacyDecrementHasCompareAndSetGuard(statement) {
  const maskedStatement = maskNestedSql(statement);
  const whereMatches = [...maskedStatement.matchAll(/\bWHERE\b/gi)];
  const where = whereMatches.at(-1);
  if (!where) return false;

  const whereClause = maskedStatement.slice(where.index + where[0].length);
  if (/\bOR\b/i.test(whereClause)) return false;

  const comparison =
    /(?:[a-z_][a-z0-9_]*\s*\.\s*)?stock_quantity\s*>=\s*stock_rec\s*\.\s*total_quantity\b/i.exec(
      whereClause
    );
  if (!comparison) return false;

  const prefix = whereClause.slice(0, comparison.index).trimEnd();
  return prefix.length === 0 || /\bAND\s*$/i.test(prefix);
}

export const serializedInventoryContract = {
  migrationsDir,
  migrationFileNames,
  functionBody,
  latestFunctionBody,
  extractIfBranches,
  legacyDecrementMatches,
  legacyDecrementHasCompareAndSetGuard,
};
