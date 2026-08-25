function splitTopLevel(source, operator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\' && next !== undefined) index += 1;
      else if (char === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(depth - 1, 0);
    else if (
      depth === 0 &&
      source.slice(index, index + operator.length).toUpperCase() === operator &&
      (index === 0 || !/[A-Z0-9_]/i.test(source[index - 1])) &&
      (index + operator.length === source.length ||
        !/[A-Z0-9_]/i.test(source[index + operator.length]))
    ) {
      parts.push(source.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  if (parts.length === 0) return [source.trim()];
  parts.push(source.slice(start).trim());
  return parts;
}

function unwrapOuterParentheses(source) {
  let expression = source.trim();
  while (expression.startsWith('(') && expression.endsWith(')')) {
    let depth = 0;
    let quote;
    let enclosesWholeExpression = true;
    for (let index = 0; index < expression.length; index += 1) {
      const char = expression[index];
      const next = expression[index + 1];
      if (quote) {
        if (char === '\\' && next !== undefined) index += 1;
        else if (char === quote) {
          if (next === quote) index += 1;
          else quote = undefined;
        }
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0 && index < expression.length - 1) {
          enclosesWholeExpression = false;
          break;
        }
      }
    }
    if (!enclosesWholeExpression || depth !== 0) break;
    expression = expression.slice(1, -1).trim();
  }
  return expression;
}

const negativePredicatePattern =
  /(?:\bIS\s+(?:FALSE|NOT\s+TRUE)\b|=\s*FALSE\b|<>\s*TRUE\b)\s*;?$/i;

function isRequiredConjunct(source, pattern) {
  const expression = unwrapOuterParentheses(source);
  const orBranches = splitTopLevel(expression, 'OR');
  if (orBranches.length > 1) {
    return orBranches.every((branch) => isRequiredConjunct(branch, pattern));
  }
  const andBranches = splitTopLevel(expression, 'AND');
  if (andBranches.length > 1) {
    return andBranches.some((branch) => isRequiredConjunct(branch, pattern));
  }
  if (/^NOT\b/i.test(expression) || negativePredicatePattern.test(expression)) {
    return false;
  }
  return pattern.test(expression);
}

export const serializedInventoryPredicates = { isRequiredConjunct };
