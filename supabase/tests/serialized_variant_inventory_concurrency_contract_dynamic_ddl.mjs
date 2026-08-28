import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function dollarQuoteAt(source, index) {
  if (source[index] !== '$') return null;
  return (
    /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(index))?.[0] ?? null
  );
}

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

function functionNameFromSignature(functionSignature) {
  return functionSignature.trim().replace(/\([^()]*\)\s*$/, '');
}

function dynamicDdlPattern(functionSignature) {
  const functionName = functionNameFromSignature(functionSignature);
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+|ALTER\\s+)(?:FUNCTION|ROUTINE)\\s+${identifierPattern(functionName)}(?![A-Za-z0-9_])`,
    'i'
  );
}

function extractExecutePayload(source, start) {
  let payload = '';
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (char === "'") {
      const literalStart = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (source[index] === "'") break;
        if (source[index] === '\\' && source[index + 1] !== undefined) {
          index += 1;
        }
        index += 1;
      }
      payload += source.slice(literalStart, Math.min(index + 1, source.length));
      continue;
    }

    const tag = dollarQuoteAt(source, index);
    if (tag) {
      const bodyStart = index + tag.length;
      const bodyEnd = source.indexOf(tag, bodyStart);
      if (bodyEnd === -1) {
        payload += source.slice(bodyStart);
        break;
      }
      payload += source.slice(bodyStart, bodyEnd);
      index = bodyEnd + tag.length - 1;
      continue;
    }

    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) break;
    else payload += char;
  }

  return payload;
}

function normalizeExecuteExpression(payload) {
  return payload
    .replace(/'((?:''|\\.|[^'])*)'/gs, (_, value) =>
      value.replaceAll("''", "'")
    )
    .replace(/\s*\|\|\s*/g, '');
}

function hasDynamicFunctionDdl(source, functionSignature) {
  const masked = serializedInventorySqlParser.maskSqlLiterals(source);
  const ddl = dynamicDdlPattern(functionSignature);
  for (const execute of masked.matchAll(/\bEXECUTE\b/gi)) {
    const payload = extractExecutePayload(
      source,
      execute.index + execute[0].length
    );
    if (ddl.test(normalizeExecuteExpression(payload))) return true;
  }
  return false;
}

export const serializedInventoryDynamicDdl = { hasDynamicFunctionDdl };
