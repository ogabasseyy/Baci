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

function dynamicPrivilegePattern(functionSignature) {
  const functionName = functionNameFromSignature(functionSignature);
  const argumentTypes = functionSignature.match(/\(([^()]*)\)\s*$/)?.[1] ?? '';
  const argumentsPattern = escapeRegex(argumentTypes)
    .replaceAll(',', '\\s*,\\s*')
    .replaceAll(' ', '\\s+');
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:GRANT|REVOKE)\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE)\\s+ON\\s+(?:FUNCTION|ROUTINE)\\s+${identifierPattern(functionName)}\\s*\\(\\s*${argumentsPattern}\\s*\\)(?=\\s+(?:TO|FROM)\\b)`,
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

    if (char === '(') {
      depth += 1;
      payload += char;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      payload += char;
    } else if (char === ';' && depth === 0) break;
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
    /%%|%(?:[1-9][0-9]*\$)?([sIL])/g,
    (match, specifier) => {
      if (match === '%%') return '%';
      const argument = parseSqlLiteral(
        parsed.argumentsList[argumentIndex++] ?? ''
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

const dynamicDdlOperationPattern =
  /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+|ALTER\s+)(?:FUNCTION|ROUTINE)\b/i;

function normalizedExecutePayload(payload) {
  const rendered = renderFormatInvocation(payload);
  if (!rendered) {
    return {
      text: normalizeExecuteExpression(payload),
      hasUnknownArguments: false,
    };
  }
  return {
    text: normalizeExecuteExpression(rendered.text),
    hasUnknownArguments: rendered.hasUnknownArguments,
  };
}

function hasDynamicFunctionDdl(source, functionSignature) {
  const masked = serializedInventorySqlParser.maskSqlLiterals(source);
  const ddl = dynamicDdlPattern(functionSignature);
  for (const execute of masked.matchAll(/\bEXECUTE\b/gi)) {
    const payload = extractExecutePayload(
      source,
      execute.index + execute[0].length
    );
    const normalized = normalizedExecutePayload(payload);
    if (ddl.test(normalized.text)) return true;
    if (
      normalized.hasUnknownArguments &&
      dynamicDdlOperationPattern.test(normalized.text)
    ) {
      return true;
    }
  }
  return false;
}

function hasDynamicPrivilegeDdl(source, functionSignature) {
  const masked = serializedInventorySqlParser.maskSqlLiterals(source);
  const privilege = dynamicPrivilegePattern(functionSignature);
  for (const execute of masked.matchAll(/\bEXECUTE\b/gi)) {
    const payload = extractExecutePayload(
      source,
      execute.index + execute[0].length
    );
    const normalized = normalizedExecutePayload(payload);
    if (privilege.test(normalized.text)) return true;
    if (
      normalized.hasUnknownArguments &&
      /\b(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:FUNCTION|ROUTINE)\b/i.test(
        normalized.text
      )
    ) {
      return true;
    }
  }
  return false;
}

export const serializedInventoryDynamicDdl = {
  hasDynamicFunctionDdl,
  hasDynamicPrivilegeDdl,
};
