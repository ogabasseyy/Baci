import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';
import { hasImmediateUnconditionalException } from './serialized_variant_inventory_concurrency_contract_zero_row.mjs';

const { isRequiredConjunct, splitSqlStatements, stripSqlComments } =
  serializedInventorySqlParser;
const identifier = '(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)';
const legacyTable = '("product_variants"|product_variants|"products"|products)';
const publicSchema = '(?:(?:"public"|public)\\s*\\.\\s*)?';
const updatePattern = new RegExp(
  `UPDATE\\s+(?:ONLY\\s+)?${publicSchema}${legacyTable}(?:\\s+(?:AS\\s+)?${identifier})?\\s+SET\\b`,
  'i'
);
const stockDecrement =
  /\bstock_quantity\s*=\s*(?:GREATEST\s*\(\s*)?(?:\(\s*)*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*(?:\(\s*)*((?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)*[a-z_][a-z0-9_]*|\d+(?:\.\d+)?)(?:\s*\))*\s*(?:,\s*0\s*)?(?:\s*\))*/i;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizedIdentifier(value) {
  return value.replace(/^"|"$/g, '').toLowerCase();
}
function referencePattern(value) {
  return value
    .replace(/\s+/g, '')
    .split('.')
    .map(escapeRegex)
    .join('\\s*\\.\\s*');
}
function legacyDecrementMatches(source) {
  const cleanSource = stripSqlComments(source);
  return splitSqlStatements(cleanSource).flatMap(({ index, text }) => {
    const update = updatePattern.exec(text);
    const decrement = stockDecrement.exec(text);
    if (!update || !decrement) return [];
    const updateStart = index + update.index;
    const context = cleanSource.slice(0, updateStart).slice(-2000);
    const match = [
      text.slice(update.index),
      normalizedIdentifier(update[1]),
      context + text.slice(update.index),
    ];
    match.index = updateStart;
    match.input = cleanSource;
    return [match];
  });
}
function maskNestedSql(source) {
  let quote;
  let masked = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      masked += ' ';
      if (char === quote) {
        if (source[index + 1] === quote) {
          masked += ' ';
          index += 1;
        } else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      masked += ' ';
    } else if (
      char === '(' &&
      /^\s*(?:SELECT|WITH|VALUES|TABLE|INSERT|UPDATE|DELETE)\b/i.test(
        source.slice(index + 1)
      )
    ) {
      masked += '(';
      let depth = 1;
      let nestedQuote;
      for (index += 1; index < source.length; index += 1) {
        const nestedChar = source[index];
        if (nestedQuote) {
          masked += ' ';
          if (nestedChar === nestedQuote) {
            if (source[index + 1] === nestedQuote) {
              masked += ' ';
              index += 1;
            } else nestedQuote = undefined;
          }
        } else if (nestedChar === "'" || nestedChar === '"') {
          nestedQuote = nestedChar;
          masked += ' ';
        } else if (nestedChar === '(') {
          depth += 1;
          masked += ' ';
        } else if (nestedChar === ')') {
          depth -= 1;
          masked += ')';
          if (depth === 0) break;
        } else masked += ' ';
      }
    } else masked += char;
  }
  return masked;
}
function stockDecrementMatch(source) {
  return [...source.matchAll(new RegExp(stockDecrement.source, 'gi'))].at(-1);
}
function decrementQuantityPattern(decrement) {
  return referencePattern(decrement?.[1] ?? 'stock_rec.total_quantity');
}
function requiredRowReference(whereClause) {
  const equality = new RegExp(
    `(?:(?:${identifier})\\s*\\.\\s*)?id\\s*=\\s*((?:${identifier}\\s*\\.\\s*)*${identifier})`,
    'gi'
  );
  for (const candidate of whereClause.matchAll(equality)) {
    if (isRequiredConjunct(whereClause, new RegExp(candidate[0], 'i'))) {
      return candidate[1];
    }
  }
  return null;
}
function updateLockTarget(statement, decrement) {
  const updates = [
    ...statement.matchAll(new RegExp(updatePattern.source, 'gi')),
  ]
    .filter((candidate) => candidate.index <= decrement.index)
    .at(-1);
  if (!updates) return null;
  const updateText = statement.slice(updates.index);
  const where = [...updateText.matchAll(/\bWHERE\b/gi)].at(-1);
  if (!where) return null;
  const rowReference = requiredRowReference(
    updateText.slice(where.index + where[0].length)
  );
  return rowReference
    ? { rowReference, table: normalizedIdentifier(updates[1]) }
    : null;
}
function matchingLockedPrecheck(statement, decrement) {
  if (!decrement || decrement.index === undefined) return false;
  const target = updateLockTarget(statement, decrement);
  if (!target) return false;
  const prefix = statement.slice(0, decrement.index);
  const quantity = decrementQuantityPattern(decrement);
  for (const { index, text } of splitSqlStatements(prefix)) {
    const select = new RegExp(
      `\\bSELECT\\s+(?:(?:${identifier})\\s*\\.\\s*)?stock_quantity\\s+INTO\\s+current_stock\\s+FROM\\s+${publicSchema}${legacyTable}(?:\\s+(?:AS\\s+)?${identifier})?\\s+WHERE\\b([\\s\\S]*?)\\bFOR\\s+UPDATE\\s*;?$`,
      'i'
    ).exec(text.trim());
    if (!select || normalizedIdentifier(select[1]) !== target.table) continue;
    const rowEquality = new RegExp(
      `(?:(?:${identifier})\\s*\\.\\s*)?id\\s*=\\s*${referencePattern(target.rowReference)}\\b`,
      'i'
    );
    if (!isRequiredConjunct(select[2], rowEquality)) continue;
    const afterLock = prefix.slice(index + text.length);
    if (
      new RegExp(
        `^\\s*IF\\s+current_stock\\s*<\\s*(?:\\(\\s*)*${quantity}\\b[\\s\\)]*\\s+THEN(?:(?!\\bEND\\s+IF\\b)[\\s\\S])*?\\bRETURN\\b`,
        'i'
      ).test(afterLock)
    ) {
      return true;
    }
  }
  return false;
}
function legacyDecrementHasCompareAndSetGuard(statement) {
  const masked = maskNestedSql(statement);
  const where = [...masked.matchAll(/\bWHERE\b/gi)].at(-1);
  if (!where) return false;
  const decrement = stockDecrementMatch(masked);
  const quantity = decrementQuantityPattern(decrement);
  const comparison = new RegExp(
    `(?:\\(\\s*)*(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\s*>=\\s*(?:\\(\\s*)*${quantity}\\b(?:\\s*\\))*|(?:\\(\\s*)*${quantity}\\s*<=\\s*(?:\\(\\s*)*(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?stock_quantity\\b(?:\\s*\\))*`,
    'i'
  );
  return (
    isRequiredConjunct(
      masked.slice(where.index + where[0].length),
      comparison
    ) || matchingLockedPrecheck(masked, decrement)
  );
}
function legacyDecrementHasZeroRowHandling(match) {
  if (hasImmediateUnconditionalException(match)) return true;
  if (!match || typeof match[2] !== 'string') return false;
  const masked = maskNestedSql(match[2]);
  if (matchingLockedPrecheck(masked, stockDecrementMatch(masked))) return true;
  const remainder = match.input?.slice(match.index + match[0].length) ?? '';
  return /^\s*(?:ELSE\b(?:(?!\bEND\s+IF\b)[\s\S])*)?END\s+IF\s*;\s*IF\s+NOT\s+FOUND\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRAISE\s+EXCEPTION\b/i.test(
    remainder
  );
}

export const serializedInventoryDecrements = {
  legacyDecrementHasCompareAndSetGuard,
  legacyDecrementHasZeroRowHandling,
  legacyDecrementMatches,
};
