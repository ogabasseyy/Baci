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

function dynamicPrivilegePattern(functionSignature) {
  const functionName = functionNameFromSignature(functionSignature);
  const argumentTypes = functionSignature.match(/\(([^()]*)\)\s*$/)?.[1] ?? '';
  const argumentsPattern = escapeRegex(argumentTypes)
    .replaceAll(',', '\\s*,\\s*')
    .replaceAll(' ', '\\s+');
  const argumentList = `(?:\\s*\\(\\s*${argumentsPattern}\\s*\\))?`;
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:GRANT|REVOKE)\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE)\\s+ON\\s+(?:FUNCTION|ROUTINE)\\s+${identifierPattern(functionName)}${argumentList}(?=\\s+(?:TO|FROM)\\b)`,
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

function assignedExecutePayload(source, executeIndex, payload) {
  const variable = /^\s*([a-z_][a-z0-9_]*)\s*$/i.exec(payload);
  if (!variable) return null;
  const assignmentPattern = new RegExp(
    `\\b${escapeRegex(variable[1])}(?:\\s+[a-z_][a-z0-9_.]*(?:\\s*\\([^;]*\\))?)?\\s*:=\\s*([^;]+)`,
    'gi'
  );
  return (
    [...source.slice(0, executeIndex).matchAll(assignmentPattern)].pop()?.[1] ??
    null
  );
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
    const assigned = assignedExecutePayload(source, execute.index, payload);
    if (assigned !== null) {
      const renderedAssigned = normalizedExecutePayload(assigned);
      if (ddl.test(renderedAssigned.text)) return true;
      if (
        renderedAssigned.hasUnknownArguments &&
        dynamicDdlOperationPattern.test(renderedAssigned.operationText)
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
    const assigned = assignedExecutePayload(source, execute.index, payload);
    if (assigned !== null) {
      const renderedAssigned = normalizedExecutePayload(assigned);
      if (privilege.test(renderedAssigned.text)) return true;
      if (
        renderedAssigned.hasUnknownArguments &&
        /\b(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:FUNCTION|ROUTINE)\b/i.test(
          renderedAssigned.operationText
        )
      ) {
        return true;
      }
    }
    if (
      normalized.hasUnknownArguments &&
      /\b(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:FUNCTION|ROUTINE)\b/i.test(
        normalized.operationText
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
