import { serializedInventoryDynamicRender } from './serialized_variant_inventory_concurrency_contract_dynamic_render.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { dollarQuoteAt, escapeRegex, maskSqlLiterals } =
  serializedInventorySqlParser;
const { renderFormatInvocation } = serializedInventoryDynamicRender;

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

function dynamicSignaturePattern(functionSignature) {
  const functionName = functionNameFromSignature(functionSignature);
  return new RegExp(
    `(?:FUNCTION|ROUTINE)\\s+${identifierPattern(functionName)}(?![A-Za-z0-9_])`,
    'i'
  );
}

function dynamicPrivilegePattern(functionSignature) {
  const functionName = functionNameFromSignature(functionSignature);
  const bareName = functionName.includes('.')
    ? functionName.slice(functionName.lastIndexOf('.') + 1)
    : functionName;
  const argumentTypes = functionSignature.match(/\(([^()]*)\)\s*$/)?.[1] ?? '';
  const argumentsPattern = escapeRegex(argumentTypes)
    .replaceAll(',', '\\s*,\\s*')
    .replaceAll(' ', '\\s+');
  const argumentList = `(?:\\s*\\(\\s*${argumentsPattern}\\s*\\))?`;
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:GRANT|REVOKE)\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE)\\s+ON\\s+(?:FUNCTION|ROUTINE)\\s+(?:${identifierPattern(functionName)}|${identifierPattern(bareName)})${argumentList}(?=\\s+(?:TO|FROM)\\b)`,
    'i'
  );
}

function dynamicSchemaPrivilegePattern(functionSignature) {
  const qualified = functionSignature.trim().replace(/\([^()]*\)\s*$/, '');
  if (!qualified.includes('.')) return null;
  const schema = qualified.slice(0, qualified.lastIndexOf('.'));
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:GRANT|REVOKE)\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE)\\s+ON\\s+ALL\\s+(?:FUNCTIONS|ROUTINES)\\s+IN\\s+SCHEMA\\s+${identifierPattern(schema)}(?![A-Za-z0-9_])`,
    'i'
  );
}

function extractExecutePayload(source, start) {
  let payload = '';
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (char === "'") {
      const prefix = source[index - 1];
      if (
        (prefix === 'E' || prefix === 'e') &&
        index - 1 >= start &&
        (index - 2 < start || /[^A-Za-z0-9_$]/.test(source[index - 2])) &&
        payload.endsWith(prefix)
      ) {
        payload = payload.slice(0, -1);
      }
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

const dynamicDdlOperationPattern =
  /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+|ALTER\s+)(?:FUNCTION|ROUTINE)\b/i;

function hasUnresolvedExpressionComponents(payload) {
  const executable = maskSqlLiterals(payload);
  return /\|\||\b(?:quote_ident|quote_literal|quote_nullable|concat|concat_ws)\s*\(/i.test(
    executable
  );
}

function expressionOperationText(payload) {
  return payload
    .replace(/'((?:''|\\.|[^'])*)'/gs, (_, value) =>
      value.replaceAll("''", "'")
    )
    .replace(/\s*\|\|\s*/g, ' ');
}

function normalizedExecutePayload(payload) {
  const rendered = renderFormatInvocation(payload);
  if (!rendered) {
    return {
      operationText: expressionOperationText(payload),
      text: normalizeExecuteExpression(payload),
      hasUnknownArguments: hasUnresolvedExpressionComponents(payload),
    };
  }
  return {
    operationText: expressionOperationText(rendered.text),
    text: normalizeExecuteExpression(rendered.text),
    hasUnknownArguments: rendered.hasUnknownArguments,
  };
}

function assignedExecutePayloads(source, executeIndex, payload) {
  const variable = /^\s*([a-z_][a-z0-9_]*)\s*$/i.exec(payload);
  if (!variable) return [];
  const before = source.slice(0, executeIndex);
  const collect = (pattern, flags) =>
    [...before.matchAll(new RegExp(pattern, flags))].map((match) => ({
      index: match.index,
      text: match[1],
    }));
  return [
    ...collect(
      `\\b${escapeRegex(variable[1])}(?:\\s+[a-z_][a-z0-9_.]*(?:\\s*\\([^;]*\\))?)?\\s*:=\\s*([^;]+)`,
      'gi'
    ),
    ...collect(
      `\\bSELECT\\b((?:(?!\\bINTO\\b)[^;])*?)\\bINTO\\s+(?:STRICT\\s+)?[^;]*?\\b${escapeRegex(variable[1])}\\b`,
      'gi'
    ),
    ...collect(
      `(?:^|[;]|\\bTHEN\\b|\\bELSE\\b|\\bLOOP\\b|\\bBEGIN\\b)\\s*${escapeRegex(variable[1])}\\s*=(?![=>])\\s*([^;]+)`,
      'gim'
    ),
  ]
    .sort((left, right) => left.index - right.index)
    .map(({ text }) => text);
}

function hasDynamicFunctionDdl(source, functionSignature) {
  const masked = serializedInventorySqlParser.maskSqlLiterals(source);
  const ddl = dynamicDdlPattern(functionSignature);
  const signature = dynamicSignaturePattern(functionSignature);
  for (const execute of masked.matchAll(/\bEXECUTE\b/gi)) {
    const payload = extractExecutePayload(
      source,
      execute.index + execute[0].length
    );
    const normalized = normalizedExecutePayload(payload);
    if (ddl.test(normalized.text)) return true;
    if (normalized.hasUnknownArguments && signature.test(normalized.text)) {
      return true;
    }
    for (const assigned of assignedExecutePayloads(
      source,
      execute.index,
      payload
    )) {
      const renderedAssigned = normalizedExecutePayload(assigned);
      if (ddl.test(renderedAssigned.text)) return true;
      if (
        renderedAssigned.hasUnknownArguments &&
        (dynamicDdlOperationPattern.test(renderedAssigned.operationText) ||
          signature.test(renderedAssigned.text))
      ) {
        return true;
      }
    }
    if (
      normalized.hasUnknownArguments &&
      dynamicDdlOperationPattern.test(normalized.operationText)
    ) {
      return true;
    }
  }
  return false;
}

const dynamicPrivilegeOperationPattern =
  /\b(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\s+\S+|(?:FUNCTION|ROUTINE))\b/i;

function hasDynamicPrivilegeDdl(source, functionSignature) {
  const masked = serializedInventorySqlParser.maskSqlLiterals(source);
  const privilege = dynamicPrivilegePattern(functionSignature);
  const schemaPrivilege = dynamicSchemaPrivilegePattern(functionSignature);
  const matchesPrivilege = (text) =>
    privilege.test(text) || schemaPrivilege?.test(text) === true;
  for (const execute of masked.matchAll(/\bEXECUTE\b/gi)) {
    const payload = extractExecutePayload(
      source,
      execute.index + execute[0].length
    );
    const normalized = normalizedExecutePayload(payload);
    if (matchesPrivilege(normalized.text)) return true;
    for (const assigned of assignedExecutePayloads(
      source,
      execute.index,
      payload
    )) {
      const renderedAssigned = normalizedExecutePayload(assigned);
      if (matchesPrivilege(renderedAssigned.text)) return true;
      if (
        renderedAssigned.hasUnknownArguments &&
        dynamicPrivilegeOperationPattern.test(renderedAssigned.operationText)
      ) {
        return true;
      }
    }
    if (
      normalized.hasUnknownArguments &&
      dynamicPrivilegeOperationPattern.test(normalized.operationText)
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
