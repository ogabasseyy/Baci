import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { dollarQuoteAt } = serializedInventorySqlParser;

function parseSqlLiteral(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'")) {
    const match =
      /^'((?:''|\\.|[^'])*)'(?:\s*::\s*[A-Za-z_][A-Za-z0-9_.]*)?$/s.exec(
        trimmed
      );
    if (!match) return null;
    return match[1].replaceAll("''", "'");
  }
  if (/^[eE]'/.test(trimmed)) {
    const match =
      /^[eE]'((?:''|\\.|[^'])*)'(?:\s*::\s*[A-Za-z_][A-Za-z0-9_.]*)?$/s.exec(
        trimmed
      );
    if (!match) return null;
    return match[1].replaceAll("''", "'");
  }
  const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(trimmed)?.[0];
  if (!tag || !trimmed.endsWith(tag)) return null;
  return trimmed.slice(tag.length, -tag.length);
}

function splitCallArguments(source, start) {
  const argumentsList = [];
  let argumentStart = start + 1;
  let depth = 0;
  let quote;
  let dollarTag;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = undefined;
      }
      continue;
    }
    if (quote) {
      if (char === quote && next === quote) index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'") {
      quote = char;
      continue;
    }
    const tag = dollarQuoteAt(source, index);
    if (tag) {
      dollarTag = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) {
        argumentsList.push(source.slice(argumentStart, index));
        return { argumentsList, end: index + 1 };
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      argumentsList.push(source.slice(argumentStart, index));
      argumentStart = index + 1;
    }
  }
  return null;
}

function renderFormatInvocation(payload) {
  const invocation = /(?:pg_catalog\s*\.\s*)?format\s*\(/i.exec(payload);
  if (!invocation) return null;
  const opening = invocation.index + invocation[0].length - 1;
  const parsed = splitCallArguments(payload, opening);
  if (!parsed || payload.slice(parsed.end).trim()) return null;

  const template = parseSqlLiteral(parsed.argumentsList[0] ?? '');
  if (template === null) {
    return { text: payload, hasUnknownArguments: true };
  }

  let argumentIndex = 1;
  let hasUnknownArguments = false;
  const text = template.replace(
    /%%|%(?:([1-9][0-9]*)\$)?([sIL])/g,
    (match, positionalIndex, specifier) => {
      if (match === '%%') return '%';
      const argument = parseSqlLiteral(
        parsed.argumentsList[
          positionalIndex ? Number(positionalIndex) : argumentIndex++
        ] ?? ''
      );
      if (argument === null) {
        hasUnknownArguments = true;
        return '__DYNAMIC_FORMAT_ARGUMENT__';
      }
      if (specifier === 'I') {
        return `"${argument.replaceAll('"', '""')}"`;
      }
      if (specifier === 'L') return `'${argument.replaceAll("'", "''")}'`;
      return argument;
    }
  );
  return { text, hasUnknownArguments };
}

export const serializedInventoryDynamicRender = {
  renderFormatInvocation,
};
