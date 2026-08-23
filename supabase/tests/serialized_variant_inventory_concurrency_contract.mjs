import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';
import { serializedInventoryLocks } from './serialized_variant_inventory_concurrency_contract_locks.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

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
const {
  findDollarQuoteEnd,
  isRequiredConjunct,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function identifierPattern(identifier) {
  return identifier
    .split('.')
    .map((part) => {
      const unquoted = part.replace(/^"|"$/g, '');
      return `(?:${escapeRegex(unquoted)}|"${escapeRegex(unquoted)}")`;
    })
    .join('\\s*\\.\\s*');
}
function parseFunctionSignature(functionSignature) {
  const normalized = functionSignature.trim();
  const match = /^(.*)\(([^()]*)\)$/.exec(normalized);
  if (!match) {
    return {
      name: normalized.replace(/\($/, ''),
      argumentTypes: [],
    };
  }
  return {
    name: match[1].trim(),
    argumentTypes: match[2]
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean),
  };
}
function parameterListPattern(argumentTypes) {
  if (argumentTypes.length === 0) return '[^)]*';
  return argumentTypes
    .map((type) => {
      const normalized = type.trim().replace(/\s+/g, ' ');
      const isArray = /\[\s*\]$/.test(normalized);
      const baseType = isArray
        ? normalized.replace(/\s*\[\s*\]$/, '').trim()
        : normalized;
      const basePattern = baseType.split(' ').map(escapeRegex).join('\\s+');
      return `[^,()]*\\b${basePattern}\\b${isArray ? '\\s*\\[\\s*\\]' : '(?!\\s*\\[\\s*\\])'}[^,()]*`;
    })
    .join('\\s*,\\s*');
}
function functionMarkerPattern(functionName, flags = 'i') {
  const { name, argumentTypes } = parseFunctionSignature(functionName);
  return new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifierPattern(name)}\\s*\\(${parameterListPattern(argumentTypes)}\\)`,
    flags
  );
}
function functionDropPattern(functionName, flags = 'i') {
  const { name, argumentTypes } = parseFunctionSignature(functionName);
  const argumentList = argumentTypes.length
    ? `(?:\\s*\\(${parameterListPattern(argumentTypes)}\\))?`
    : '(?:\\s*\\([^;]*\\))?';
  return new RegExp(
    `DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${identifierPattern(name)}${argumentList}\\s*(?:CASCADE|RESTRICT)?\\s*;`,
    flags
  );
}
function functionRenamePattern(functionName, flags = 'i') {
  const { name, argumentTypes } = parseFunctionSignature(functionName);
  return new RegExp(
    `ALTER\\s+FUNCTION\\s+${identifierPattern(name)}\\s*\\(${parameterListPattern(argumentTypes)}\\)\\s+RENAME\\s+TO\\s+(?:[a-z_][a-z0-9_]*|"[^"]+")\\s*;`,
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
  const closing = findDollarQuoteEnd(source, bodyStart, opening[1]);
  assert.ok(closing, `unterminated ${functionName}`);
  return source.slice(start, closing.index);
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
    const rename = [
      ...source.matchAll(functionRenamePattern(functionName, 'gi')),
    ].at(-1);
    const invalidator =
      drop && rename
        ? drop.index > rename.index
          ? drop
          : rename
        : (drop ?? rename);
    if (invalidator && (!create || invalidator.index > create.index)) {
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
  let caseDepth = 0;
  let inElse = false;
  const thenLines = [];
  const elseLines = [];

  for (const line of lines.slice(openingIndex + 1)) {
    const sqlLine = line.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, '');
    const endCaseCount = (sqlLine.match(/\bEND\s+CASE\b/gi) ?? []).length;
    const caseTokenCount = (sqlLine.match(/\bCASE\b/gi) ?? []).length;
    caseDepth = Math.max(0, caseDepth + caseTokenCount - endCaseCount * 2);

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
    } else if (depth === 1 && caseDepth === 0 && /^\s*ELSE\b/i.test(line)) {
      inElse = true;
      continue;
    }

    (inElse ? elseLines : thenLines).push(line);
  }

  assert.fail('unterminated target IF branch');
}
function legacyDecrementMatches(source) {
  const stockDecrement =
    /\bstock_quantity\s*=\s*(?:GREATEST\s*\(\s*)?(?:\(\s*)*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*[a-z_][a-z0-9_]*\s*\.\s*total_quantity\b(?:\s*\))*\s*(?:,\s*0\s*)?(?:\s*\))*/i;
  const cleanSource = stripSqlComments(source);
  return splitSqlStatements(cleanSource).flatMap(({ index, text }) => {
    const update =
      /UPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?(product_variants|products)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\b/i.exec(
        text
      );
    if (!update || !stockDecrement.test(text)) return [];

    const match = [
      text.slice(update.index),
      update[1],
      text.slice(update.index),
    ];
    match.index = index + update.index;
    match.input = cleanSource;
    return [match];
  });
}
function legacyDecrementHasZeroRowHandling(match) {
  if (!match || typeof match.input !== 'string' || match.index === undefined) {
    return false;
  }
  const remainder = match.input.slice(match.index + match[0].length);
  const immediateIf =
    /^\s*IF\s+NOT\s+FOUND\s+THEN\b([\s\S]*?)\bEND\s+IF\s*;/i.exec(remainder);
  return immediateIf !== null && /\bRAISE\s+EXCEPTION\b/i.test(immediateIf[1]);
}
function maskNestedSql(source) {
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
    } else if (
      char === '(' &&
      /^\s*(?:SELECT|WITH|VALUES|TABLE|INSERT|UPDATE|DELETE)\b/i.test(
        source.slice(index + 1)
      )
    ) {
      masked += '(';
      let nestedDepth = 1;
      let nestedQuote;
      for (index += 1; index < source.length; index += 1) {
        const nestedChar = source[index];
        if (nestedQuote) {
          masked += ' ';
          if (nestedChar === nestedQuote) {
            if (source[index + 1] === nestedQuote) {
              masked += ' ';
              index += 1;
            } else {
              nestedQuote = undefined;
            }
          }
          continue;
        }
        if (nestedChar === "'" || nestedChar === '"') {
          nestedQuote = nestedChar;
          masked += ' ';
        } else if (nestedChar === '(') {
          nestedDepth += 1;
          masked += ' ';
        } else if (nestedChar === ')') {
          nestedDepth -= 1;
          masked += ')';
          if (nestedDepth === 0) break;
        } else {
          masked += ' ';
        }
      }
    } else {
      masked += char;
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

  const decrement =
    /\bstock_quantity\s*=\s*(?:GREATEST\s*\(\s*)?(?:\(\s*)*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*([a-z_][a-z0-9_]*)\s*\.\s*total_quantity\b/i.exec(
      maskedStatement
    );
  const recordName = decrement?.[1] ?? 'stock_rec';
  const record = escapeRegex(recordName);
  const comparison = new RegExp(
    `(?:\\(\\s*)*(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\s*>=\\s*(?:\\(\\s*)*${record}\\s*\\.\\s*total_quantity\\b(?:\\s*\\))*|(?:\\(\\s*)*${record}\\s*\\.\\s*total_quantity\\s*<=\\s*(?:\\(\\s*)*(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\b(?:\\s*\\))*`,
    'i'
  );
  return isRequiredConjunct(whereClause, comparison);
}
export const serializedInventoryContract = {
  migrationsDir,
  migrationFileNames,
  functionBody,
  latestFunctionBody,
  extractIfBranches,
  legacyDecrementMatches,
  legacyDecrementHasZeroRowHandling,
  legacyDecrementHasCompareAndSetGuard,
  availableUnitPredicatesMatch:
    serializedInventoryAvailability.availableUnitPredicatesMatch,
  findClaimLocks: serializedInventoryLocks.findClaimLocks,
};
