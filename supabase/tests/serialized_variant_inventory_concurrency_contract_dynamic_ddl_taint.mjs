import { serializedInventoryDefinitionPatches } from './serialized_variant_inventory_concurrency_contract_definition_patches.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { escapeRegex, maskSqlLiterals, stripSqlComments } =
  serializedInventorySqlParser;
const { isTracedDefinitionTransform } = serializedInventoryDefinitionPatches;

function executeVariableName(payload) {
  const executable = payload.replace(
    /^(\s*\(?\s*[a-z_][a-z0-9_]*\s*\)?)\s+(?:INTO\b[\s\S]*|USING\b[\s\S]*)$/i,
    '$1'
  );
  return (
    /^\s*\(?\s*([a-z_][a-z0-9_]*)\s*\)?\s*$/i.exec(executable)?.[1] ?? null
  );
}

function assignedExecutePayloads(source, executeIndex, payload) {
  const variable = executeVariableName(payload);
  if (!variable) return [];
  const before = source.slice(0, executeIndex);
  const collect = (pattern, flags) =>
    [...before.matchAll(new RegExp(pattern, flags))].map((match) => ({
      index: match.index,
      text: match[1],
    }));
  return [
    ...collect(
      `\\b${escapeRegex(variable)}(?:\\s+[a-z_][a-z0-9_.]*(?:\\s*\\([^;]*\\))?)?\\s*:=\\s*([^;]+)`,
      'gi'
    ),
    ...collect(
      `\\bSELECT\\b((?:(?!\\bINTO\\b)[^;])*?)\\bINTO\\s+(?:STRICT\\s+)?[^;]*?\\b${escapeRegex(variable)}\\b`,
      'gi'
    ),
    ...collect(
      `(?:^|[;]|\\bTHEN\\b|\\bELSE\\b|\\bLOOP\\b|\\bBEGIN\\b)\\s*${escapeRegex(variable)}\\s*=(?![=>])\\s*([^;]+)`,
      'gim'
    ),
  ]
    .sort((left, right) => left.index - right.index)
    .map(({ text }) => text);
}

const functionDefinitionPattern =
  /\b(?:pg_catalog\s*\.\s*)?pg_get_functiondef\s*\(/i;

function derivesFromFunctionDefinition(source, executeIndex, expression, seen) {
  if (functionDefinitionPattern.test(expression)) return true;
  if (seen.size > 50) return true;
  const masked = maskSqlLiterals(expression);
  for (const reference of masked.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
    const name = reference[1].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const assigned of assignedExecutePayloads(
      source,
      executeIndex,
      reference[1]
    )) {
      if (derivesFromFunctionDefinition(source, executeIndex, assigned, seen)) {
        return true;
      }
    }
  }
  return false;
}

function splitReplaceArguments(inner) {
  const args = [];
  let depth = 0;
  let quote;
  let dollarTag;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    if (dollarTag) {
      if (inner.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    const char = inner[index];
    if (quote) {
      if (char === quote && inner[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'") {
      quote = char;
      continue;
    }
    if (char === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        inner.slice(index)
      )?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      args.push(inner.slice(start, index));
      start = index + 1;
    }
  }
  args.push(inner.slice(start));
  return args;
}

function unquoteLiteral(text) {
  const trimmed = text.trim();
  const quoted = /^'((?:''|[^'])*)'$/s.exec(trimmed);
  if (quoted) return quoted[1].replaceAll("''", "'");
  const dollar = /^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*)\1$/.exec(trimmed);
  if (dollar) return dollar[2];
  return null;
}

function parseReplaceTransform(expression) {
  const call = /^(?:pg_catalog\s*\.\s*)?replace\s*\(/i.exec(expression.trim());
  if (!call) return null;
  const inner = expression
    .trim()
    .slice(call[0].length)
    .replace(/\)\s*(?:::\s*[a-z_][a-z0-9_\s]*(\([^)]*\))?)?$/i, '');
  const args = splitReplaceArguments(inner);
  if (args.length !== 3) return null;
  const oldText = unquoteLiteral(args[1]);
  const newText = unquoteLiteral(args[2]);
  if (oldText === null || newText === null) return null;
  return { base: args[0], oldText, newText };
}

function bareFunctionName(functionSignature) {
  const match = /^(.*)\(([^()]*)\)$/.exec(functionSignature.trim());
  const name = (match ? match[1] : functionSignature).trim();
  const bare = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1)
    : name;
  return bare.replace(/^"|"$/g, '').toLowerCase();
}

function addBareTarget(targets, qualified) {
  targets.add(
    (qualified.includes('.')
      ? qualified.slice(qualified.lastIndexOf('.') + 1)
      : qualified
    ).toLowerCase()
  );
}

function patchTargetsBefore(source, executeIndex) {
  const before = stripSqlComments(source.slice(0, executeIndex));
  const targets = new Set();
  for (const match of before.matchAll(/\bproname\s*=\s*'([^']+)'/gi)) {
    targets.add(match[1].toLowerCase());
  }
  for (const match of before.matchAll(/\bproname\s+IN\s*\(([^)]+)\)/gi)) {
    for (const name of match[1].matchAll(/'([^']+)'/g)) {
      targets.add(name[1].toLowerCase());
    }
  }
  for (const match of before.matchAll(/'([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    addBareTarget(targets, match[1]);
  }
  for (const match of before.matchAll(
    /\bto_regprocedure\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_.]*)/gi
  )) {
    addBareTarget(targets, match[1]);
  }
  return targets;
}

function targetsProtectedFunction(source, executeIndex, functionSignature) {
  const targets = patchTargetsBefore(source, executeIndex);
  return targets.size === 0 || targets.has(bareFunctionName(functionSignature));
}

function isVerbatimDefinitionInstall(expression) {
  let text = expression.trim();
  while (/^\(.*\)$/.test(text)) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/::\s*[a-z_][a-z0-9_\s]*(\([^)]*\))?$/i, '').trim();
  const call = /^(?:pg_catalog\s*\.\s*)?pg_get_functiondef\s*\(/i.exec(text);
  if (!call) return false;
  let depth = 0;
  let quote;
  for (let index = call[0].length - 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(index + 1).trim() === '';
      }
    }
  }
  return false;
}

function executesUntracedDefinitionTransform(
  source,
  executeIndex,
  payload,
  functionSignature
) {
  const variable = executeVariableName(payload);
  if (!variable) return false;
  for (const assigned of assignedExecutePayloads(
    source,
    executeIndex,
    variable
  )) {
    if (
      !derivesFromFunctionDefinition(
        source,
        executeIndex,
        assigned,
        new Set([variable.toLowerCase()])
      )
    ) {
      continue;
    }
    if (isVerbatimDefinitionInstall(assigned)) {
      continue;
    }
    const transform = parseReplaceTransform(assigned);
    if (!transform) {
      if (targetsProtectedFunction(source, executeIndex, functionSignature)) {
        return true;
      }
      continue;
    }
    if (
      !derivesFromFunctionDefinition(
        source,
        executeIndex,
        transform.base,
        new Set()
      )
    ) {
      continue;
    }
    if (isTracedDefinitionTransform(transform.oldText, transform.newText)) {
      continue;
    }
    if (targetsProtectedFunction(source, executeIndex, functionSignature)) {
      return true;
    }
  }
  return false;
}

export const serializedInventoryDynamicTaint = {
  assignedExecutePayloads,
  executesUntracedDefinitionTransform,
};
