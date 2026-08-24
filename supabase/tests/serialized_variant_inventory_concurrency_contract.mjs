import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryLocks } from './serialized_variant_inventory_concurrency_contract_locks.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';
import { hasImmediateUnconditionalException } from './serialized_variant_inventory_concurrency_contract_zero_row.mjs';

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
const { extractIfBranches } = serializedInventoryBranches;
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
function functionMovePattern(functionName, flags = 'i') {
  const { name, argumentTypes } = parseFunctionSignature(functionName);
  return new RegExp(
    `ALTER\\s+FUNCTION\\s+${identifierPattern(name)}\\s*\\(${parameterListPattern(argumentTypes)}\\)\\s+(?:RENAME\\s+TO\\s+(?:[a-z_][a-z0-9_]*|"[^"]+")|SET\\s+SCHEMA\\s+(?:[a-z_][a-z0-9_]*|"[^"]+"))\\s*;`,
    flags
  );
}
function functionBody(source, functionName, markerIndex) {
  const start =
    markerIndex ??
    latestStatementMatch(source, functionMarkerPattern(functionName, 'gi'))
      ?.index ??
    -1;
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
function latestStatementMatch(source, pattern) {
  return splitSqlStatements(source)
    .flatMap(({ index, text }) => {
      const leading = text.search(/\S/);
      const match = [...text.matchAll(pattern)].find(
        (candidate) => candidate.index === leading
      );
      if (!match) return [];
      match.index += index;
      return [match];
    })
    .at(-1);
}
function latestFunctionBody(functionName, sources = migrationSources) {
  let latestBody;
  for (const rawSource of sources) {
    const source = stripSqlComments(rawSource);
    const create = latestStatementMatch(
      source,
      functionMarkerPattern(functionName, 'gi')
    );
    const drop = latestStatementMatch(
      source,
      functionDropPattern(functionName, 'gi')
    );
    const move = latestStatementMatch(
      source,
      functionMovePattern(functionName, 'gi')
    );
    const invalidator = [drop, move]
      .filter(Boolean)
      .sort((left, right) => left.index - right.index)
      .at(-1);
    if (invalidator && (!create || invalidator.index > create.index)) {
      latestBody = undefined;
    } else if (create) {
      latestBody = functionBody(source, functionName, create.index);
    }
  }
  assert.ok(latestBody, `missing ${functionName} in migrations`);
  return latestBody;
}
const stockDecrement =
  /\bstock_quantity\s*=\s*(?:GREATEST\s*\(\s*)?(?:\(\s*)*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*(?:\(\s*)*((?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)*[a-z_][a-z0-9_]*|\d+(?:\.\d+)?)(?:\s*\))*\s*(?:,\s*0\s*)?(?:\s*\))*/i;
function legacyDecrementMatches(source) {
  const cleanSource = stripSqlComments(source);
  return splitSqlStatements(cleanSource).flatMap(({ index, text }) => {
    const update =
      /UPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?(product_variants|products)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\b/i.exec(
        text
      );
    const decrement = stockDecrement.exec(text);
    if (!update || !decrement) return [];
    const updateStart = index + update.index;
    const context = cleanSource.slice(0, updateStart).slice(-2000);
    const match = [
      text.slice(update.index),
      update[1],
      context + text.slice(update.index),
    ];
    match.index = index + update.index;
    match.input = cleanSource;
    return [match];
  });
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
function stockDecrementMatch(source) {
  return [...source.matchAll(new RegExp(stockDecrement.source, 'gi'))].at(-1);
}
function decrementQuantityPattern(decrement) {
  return (decrement?.[1]?.replace(/\s+/g, '') ?? 'stock_rec.total_quantity')
    .split('.')
    .map(escapeRegex)
    .join('\\s*\\.\\s*');
}
function hasLockedPrecheck(statement, decrement) {
  if (!decrement || decrement.index === undefined) return false;
  const quantityPattern = decrementQuantityPattern(decrement);
  return new RegExp(
    `\\bSELECT\\s+(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\s+INTO\\s+current_stock\\b(?:(?!\\bUPDATE\\b)[\\s\\S])*?\\bFOR\\s+UPDATE\\s*;(?:(?!\\bUPDATE\\b)[\\s\\S])*?\\bIF\\s+current_stock\\s*<\\s*(?:\\(\\s*)*${quantityPattern}\\b[\\s\\)]*(?:(?!\\bUPDATE\\b)[\\s\\S])*?\\bRETURN\\b`,
    'i'
  ).test(statement.slice(0, decrement.index));
}
function legacyDecrementHasCompareAndSetGuard(statement) {
  const maskedStatement = maskNestedSql(statement);
  const whereMatches = [...maskedStatement.matchAll(/\bWHERE\b/gi)];
  const where = whereMatches.at(-1);
  if (!where) return false;
  const whereClause = maskedStatement.slice(where.index + where[0].length);
  const decrement = stockDecrementMatch(maskedStatement);
  const quantityPattern = decrementQuantityPattern(decrement);
  const comparison = new RegExp(
    `(?:\\(\\s*)*(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\s*>=\\s*(?:\\(\\s*)*${quantityPattern}\\b(?:\\s*\\))*|(?:\\(\\s*)*${quantityPattern}\\s*<=\\s*(?:\\(\\s*)*(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\b(?:\\s*\\))*`,
    'i'
  );
  return (
    isRequiredConjunct(whereClause, comparison) ||
    hasLockedPrecheck(maskedStatement, decrement)
  );
}
function legacyDecrementHasZeroRowHandling(match) {
  if (hasImmediateUnconditionalException(match)) return true;
  if (!match || typeof match[2] !== 'string') return false;
  const maskedStatement = maskNestedSql(match[2]);
  if (
    hasLockedPrecheck(maskedStatement, stockDecrementMatch(maskedStatement))
  ) {
    return true;
  }
  const remainder = match.input?.slice(match.index + match[0].length) ?? '';
  return /^\s*(?:ELSE\b(?:(?!\bEND\s+IF\b)[\s\S])*)?END\s+IF\s*;\s*IF\s+NOT\s+FOUND\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRAISE\s+EXCEPTION\b/i.test(
    remainder
  );
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
