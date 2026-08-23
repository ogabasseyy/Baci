function dollarQuoteAt(source, index) {
  if (source[index] !== '$') return null;
  return (
    /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(index))?.[0] ?? null
  );
}
function dollarQuoteMode(source, index) {
  return /(?:\bAS|\bDO)\s*$/i.test(source.slice(0, index)) ? 'body' : 'literal';
}
function stripSqlComments(source) {
  let output = '';
  let quote;
  const dollarQuotes = [];
  let lineComment = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const dollarQuote = dollarQuotes.at(-1);

    if (dollarQuote?.mode === 'literal') {
      if (source.startsWith(dollarQuote.tag, index)) {
        output += dollarQuote.tag;
        index += dollarQuote.tag.length - 1;
        dollarQuotes.pop();
      } else {
        output += char;
      }
      continue;
    }
    if (lineComment) {
      if (char === '\r' || char === '\n') {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
      } else if (char === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
      } else if (char === '\r' || char === '\n') {
        output += char;
      }
      continue;
    }
    if (quote) {
      output += char;
      if (char === '\\' && next !== undefined) {
        output += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          output += next;
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (dollarQuote && source.startsWith(dollarQuote.tag, index)) {
      output += dollarQuote.tag;
      index += dollarQuote.tag.length - 1;
      dollarQuotes.pop();
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }
    const tag = dollarQuoteAt(source, index);
    if (tag) {
      dollarQuotes.push({
        mode: dollarQuote ? 'literal' : dollarQuoteMode(source, index),
        tag,
      });
      output += tag;
      index += tag.length - 1;
      continue;
    }
    output += char;
  }

  return output;
}
function splitTopLevel(source, operator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\' && next !== undefined) {
        index += 1;
      } else if (char === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(depth - 1, 0);
    } else if (
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
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
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

function findDollarQuoteEnd(source, start, delimiter) {
  let quote;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\' && next !== undefined) {
        index += 1;
      } else if (char === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (!source.startsWith(delimiter, index)) continue;

    let boundary = index - 1;
    while (boundary >= start && /[\t ]/.test(source[boundary])) boundary -= 1;
    const atBoundary =
      index === start || source[index - 1] === '\n' || source[boundary] === ';';
    if (!atBoundary) continue;
    const suffix = /^[\t ]*[^\r\n;]*;/.exec(
      source.slice(index + delimiter.length)
    );
    if (suffix) {
      return { index };
    }
  }
  return null;
}

const negativePredicatePattern = /\bIS\s+(?:FALSE|NOT\s+TRUE)\b\s*;?$/i;

function isRequiredConjunct(source, pattern) {
  const expression = unwrapOuterParentheses(source);
  if (/^NOT\b/i.test(expression) || negativePredicatePattern.test(expression)) {
    return false;
  }
  const orBranches = splitTopLevel(expression, 'OR');
  if (orBranches.length > 1) {
    return orBranches.every((branch) => isRequiredConjunct(branch, pattern));
  }
  const andBranches = splitTopLevel(expression, 'AND');
  if (andBranches.length > 1) {
    return andBranches.some((branch) => isRequiredConjunct(branch, pattern));
  }
  return pattern.test(expression);
}

function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let quote;
  const dollarQuotes = [];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const dollarQuote = dollarQuotes.at(-1);

    if (dollarQuote?.mode === 'literal') {
      if (source.startsWith(dollarQuote.tag, index)) {
        index += dollarQuote.tag.length - 1;
        dollarQuotes.pop();
      }
      continue;
    }
    if (dollarQuote && source.startsWith(dollarQuote.tag, index)) {
      index += dollarQuote.tag.length - 1;
      dollarQuotes.pop();
      continue;
    }
    if (quote) {
      if (char === '\\' && next !== undefined) {
        index += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    const tag = dollarQuoteAt(source, index);
    if (tag) {
      dollarQuotes.push({
        mode: dollarQuote ? 'literal' : dollarQuoteMode(source, index),
        tag,
      });
      index += tag.length - 1;
    } else if (char === ';') {
      statements.push({
        index: start,
        text: source.slice(start, index + 1),
      });
      start = index + 1;
    }
  }

  if (source.slice(start).trim()) {
    statements.push({ index: start, text: source.slice(start) });
  }
  return statements;
}

export const serializedInventorySqlParser = {
  findDollarQuoteEnd,
  isRequiredConjunct,
  splitSqlStatements,
  stripSqlComments,
};
