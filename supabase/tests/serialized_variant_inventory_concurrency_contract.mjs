import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryDecrements } from './serialized_variant_inventory_concurrency_contract_decrements.mjs';
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
const { findDollarQuoteEnd, splitSqlStatements, stripSqlComments } =
  serializedInventorySqlParser;
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
  const parameterMode = '(?:(?:INOUT|IN|VARIADIC)\\s+)?';
  return argumentTypes
    .map((type) => {
      const normalized = canonicalType(type);
      const isArray = /\[\s*\]$/.test(normalized);
      const baseType = isArray
        ? normalized.replace(/\s*\[\s*\]$/, '').trim()
        : normalized;
      const typeAliases = {
        decimal: '(?:numeric|decimal|"numeric"|"decimal")',
        integer: '(?:integer|int4|"integer"|"int4")',
        int4: '(?:integer|int4|"integer"|"int4")',
        numeric: '(?:numeric|decimal|"numeric"|"decimal")',
      };
      const basePattern =
        typeAliases[baseType.toLowerCase()] ??
        (/^[a-z_][a-z0-9_]*$/i.test(baseType)
          ? `(?:${escapeRegex(baseType)}|"${escapeRegex(baseType)}")`
          : baseType.split(' ').map(escapeRegex).join('\\s+'));
      const qualifiedBasePattern = baseType.includes('.')
        ? basePattern
        : `(?:(?:pg_catalog|"pg_catalog")\\s*\\.\\s*)?${basePattern}`;
      const parameterName = `(?:(?!OUT\\b)(?!${qualifiedBasePattern}\\b)(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+)?`;
      const arrayPattern = isArray ? '\\s*\\[\\s*\\]' : '(?!\\s*\\[\\s*\\])';
      return `\\s*${parameterMode}${parameterName}${qualifiedBasePattern}${arrayPattern}(?:\\s+(?:DEFAULT\\b|=)[^,)]*)?\\s*`;
    })
    .join('\\s*,\\s*');
}
function normalizedFunctionIdentifier(source) {
  return [...source.matchAll(/"[^"]+"|[a-z_][a-z0-9_]*/gi)].map((part) =>
    part[0].startsWith('"') ? part[0].slice(1, -1) : part[0].toLowerCase()
  );
}
function createTargetsFunction(statement, functionName) {
  const target =
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))*)/i.exec(
      statement
    );
  if (!target) return false;
  return (
    JSON.stringify(normalizedFunctionIdentifier(target[1])) ===
    JSON.stringify(
      normalizedFunctionIdentifier(parseFunctionSignature(functionName).name)
    )
  );
}
function splitParameters(source) {
  const parameters = [];
  let start = 0;
  let depth = 0;
  let quote;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index + 1] === quote) index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parameters.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parameters.push(source.slice(start));
  return parameters;
}
function canonicalType(type) {
  const normalized = type
    .trim()
    .toLowerCase()
    .replaceAll('"', '')
    .replace(/^pg_catalog\s*\.\s*/, '')
    .replace(/\s*\[\s*\]/g, '[]')
    .replace(/\s+/g, ' ');
  return { decimal: 'numeric', int4: 'integer' }[normalized] ?? normalized;
}
function declarationInputTypes(statement) {
  const declaration =
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:"[^"]+"|[a-z_][a-z0-9_]*)\s*\.\s*)?(?:"[^"]+"|[a-z_][a-z0-9_]*)\s*\(/i.exec(
      statement
    );
  if (!declaration) return [];
  const start = declaration[0].length;
  let depth = 1;
  let quote;
  let end = start;
  for (; end < statement.length && depth > 0; end += 1) {
    const char = statement[end];
    if (quote) {
      if (char === quote && statement[end + 1] === quote) end += 1;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
  }
  return splitParameters(statement.slice(start, end - 1)).flatMap((raw) => {
    const withoutDefault = raw.split(/\s+(?:DEFAULT\b|=)/i, 1)[0].trim();
    const mode = /^(INOUT|IN|OUT|VARIADIC)\s+/i.exec(withoutDefault);
    if (mode?.[1].toUpperCase() === 'OUT') return [];
    const parameter = withoutDefault.slice(mode?.[0].length ?? 0).trim();
    const tokens = parameter.split(/\s+/);
    const type = tokens.length > 1 ? tokens.slice(1).join(' ') : parameter;
    return canonicalType(type);
  });
}
function declarationMatchesSignature(statement, functionName) {
  const expected =
    parseFunctionSignature(functionName).argumentTypes.map(canonicalType);
  const actual = declarationInputTypes(statement);
  return (
    createTargetsFunction(statement, functionName) &&
    JSON.stringify(actual) === JSON.stringify(expected)
  );
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
    `DROP\\s+(?:FUNCTION|ROUTINE)\\s+(?:IF\\s+EXISTS\\s+)?(?:[^;]*,\\s*)?${identifierPattern(name)}${argumentList}(?:\\s*,[^;]*)?\\s*(?:CASCADE|RESTRICT)?\\s*;`,
    flags
  );
}
function functionMovePattern(functionName, flags = 'i') {
  const { name, argumentTypes } = parseFunctionSignature(functionName);
  return new RegExp(
    `ALTER\\s+(?:FUNCTION|ROUTINE)\\s+${identifierPattern(name)}\\s*\\(${parameterListPattern(argumentTypes)}\\)\\s+(?:RENAME\\s+TO\\s+(?:[a-z_][a-z0-9_]*|"[^"]+")|SET\\s+SCHEMA\\s+(?:[a-z_][a-z0-9_]*|"[^"]+"))\\s*;`,
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
function latestStatementMatch(source, pattern, validator = () => true) {
  return splitSqlStatements(source)
    .flatMap(({ index, text }) => {
      const leading = text.search(/\S/);
      const match = [...text.matchAll(pattern)].find(
        (candidate) => candidate.index === leading
      );
      if (!match || !validator(text)) return [];
      match.index += index;
      return [match];
    })
    .at(-1);
}
function latestFunctionBody(functionName, sources = migrationSources) {
  let latestBody;
  const { name } = parseFunctionSignature(functionName);
  const namePresence = new RegExp(identifierPattern(name), 'i');
  for (const rawSource of sources) {
    if (!namePresence.test(rawSource)) continue;
    const source = stripSqlComments(rawSource);
    const create = latestStatementMatch(
      source,
      new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifierPattern(name)}\\s*\\(`,
        'gi'
      ),
      (statement) => declarationMatchesSignature(statement, functionName)
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
const {
  legacyDecrementHasCompareAndSetGuard,
  legacyDecrementHasZeroRowHandling,
  legacyDecrementMatches,
} = serializedInventoryDecrements;
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
  availableUnitWhereClause:
    serializedInventoryAvailability.availableUnitWhereClause,
  findClaimLocks: serializedInventoryLocks.findClaimLocks,
  claimLocksDominateSelector:
    serializedInventoryLocks.claimLocksDominateSelector,
};
