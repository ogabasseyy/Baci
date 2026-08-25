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
  const parameterName = '(?:(?!OUT\\b)(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+)?';
  const parameterMode = '(?:(?:INOUT|IN|VARIADIC)\\s+)?';
  return argumentTypes
    .map((type) => {
      const normalized = type.trim().replace(/\s+/g, ' ');
      const isArray = /\[\s*\]$/.test(normalized);
      const baseType = isArray
        ? normalized.replace(/\s*\[\s*\]$/, '').trim()
        : normalized;
      const typeAliases = {
        integer: '(?:integer|int4)',
        int4: '(?:integer|int4)',
      };
      const basePattern =
        typeAliases[baseType.toLowerCase()] ??
        baseType.split(' ').map(escapeRegex).join('\\s+');
      const qualifiedBasePattern = baseType.includes('.')
        ? basePattern
        : `(?:(?:pg_catalog|"pg_catalog")\\s*\\.\\s*)?${basePattern}`;
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
      functionMarkerPattern(functionName, 'gi'),
      (statement) => createTargetsFunction(statement, functionName)
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
function latestFunctionBodyByName(functionName, sources = migrationSources) {
  const name = parseFunctionSignature(functionName).name;
  const marker = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${identifierPattern(name)}\\s*\\(`,
    'gi'
  );
  const invalidator = new RegExp(
    `(?:DROP\\s+(?:FUNCTION|ROUTINE)\\s+(?:IF\\s+EXISTS\\s+)?${identifierPattern(name)}(?:\\s*\\([^;]*\\))?|ALTER\\s+(?:FUNCTION|ROUTINE)\\s+${identifierPattern(name)}\\s*\\([^;]*\\)\\s+(?:RENAME\\s+TO|SET\\s+SCHEMA))[^;]*;`,
    'gi'
  );
  let latestBody;
  const namePresence = new RegExp(identifierPattern(name), 'i');
  for (const rawSource of sources) {
    if (!namePresence.test(rawSource)) continue;
    const source = stripSqlComments(rawSource);
    const create = latestStatementMatch(source, marker, (statement) =>
      createTargetsFunction(statement, name)
    );
    const invalidate = latestStatementMatch(source, invalidator);
    if (invalidate && (!create || invalidate.index > create.index)) {
      latestBody = undefined;
    } else if (create) {
      latestBody = functionBody(source, name, create.index);
    }
  }
  assert.ok(latestBody, `missing ${name} in migrations`);
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
  latestFunctionBodyByName,
  extractIfBranches,
  legacyDecrementMatches,
  legacyDecrementHasZeroRowHandling,
  legacyDecrementHasCompareAndSetGuard,
  availableUnitPredicatesMatch:
    serializedInventoryAvailability.availableUnitPredicatesMatch,
  availableUnitWhereClause:
    serializedInventoryAvailability.availableUnitWhereClause,
  findClaimLocks: serializedInventoryLocks.findClaimLocks,
};
