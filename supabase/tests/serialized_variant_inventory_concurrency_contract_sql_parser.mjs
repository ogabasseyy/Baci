import { serializedInventoryPredicates } from './serialized_variant_inventory_concurrency_contract_predicates.mjs';

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
      output += ' ';
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
  isRequiredConjunct: serializedInventoryPredicates.isRequiredConjunct,
  splitSqlStatements,
  stripSqlComments,
};
