import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';
import { hasImmediateUnconditionalException } from './serialized_variant_inventory_concurrency_contract_zero_row.mjs';

const {
  isRequiredConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;
const identifier = '(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)';
const legacyTable = '("product_variants"|product_variants|"products"|products)';
const publicSchema = '(?:(?:"public"|public)\\s*\\.\\s*)?';
const stockColumn = '(?:"stock_quantity"|stock_quantity)';
const quantityAtom =
  '(?:(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)*[a-z_][a-z0-9_]*|\\d+(?:\\.\\d+)?)';
const quantityExpression = `${quantityAtom}(?:\\s*[*+/-]\\s*${quantityAtom})*`;
const updatePattern = new RegExp(
  `UPDATE\\s+(?:ONLY\\s+)?${publicSchema}${legacyTable}(?:\\s+(?:AS\\s+)?(${identifier}))?\\s+SET\\b`,
  'i'
);
const stockDecrement = new RegExp(
  `${stockColumn}\\s*=\\s*(?:GREATEST\\s*\\(\\s*)?(?:\\(\\s*)*(?:(?:${identifier})\\s*\\.\\s*)?${stockColumn}\\s*-\\s*(?:\\(\\s*)*(${quantityExpression})(?:\\s*\\))*\\s*(?:,\\s*0\\s*)?(?:\\s*\\))*`,
  'i'
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizedIdentifier(value) {
  return value.replace(/^"|"$/g, '').toLowerCase();
}
function referencePattern(value) {
  return escapeRegex(value.replace(/\s+/g, ''))
    .replaceAll('\\.', '\\s*\\.\\s*')
    .replaceAll('\\*', '\\s*\\*\\s*')
    .replaceAll('\\+', '\\s*\\+\\s*')
    .replaceAll('\\-', '\\s*-\\s*')
    .replaceAll('/', '\\s*/\\s*');
}
function legacyDecrementMatches(source) {
  const cleanSource = stripSqlComments(source);
  return splitSqlStatements(cleanSource).flatMap(({ index, text }) => {
    const updates = [...text.matchAll(new RegExp(updatePattern.source, 'gi'))];
    return updates.flatMap((update, updateIndex) => {
      const end = updates[updateIndex + 1]?.index ?? text.length;
      const updateText = text.slice(update.index, end);
      if (!stockDecrement.test(updateText)) return [];
      const updateStart = index + update.index;
      const precedingSource = cleanSource.slice(0, updateStart);
      const functionStart = [
        ...precedingSource.matchAll(
          /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi
        ),
      ].at(-1)?.index;
      const context = precedingSource.slice(functionStart ?? -2000);
      const match = [
        updateText,
        normalizedIdentifier(update[1]),
        context + updateText,
      ];
      match.index = updateStart;
      match.input = cleanSource;
      return [match];
    });
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
    if (char === "'") {
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
        } else if (nestedChar === "'") {
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
    `(?:(?:${identifier})\\s*\\.\\s*)*id\\s*=\\s*((?:${identifier}\\s*\\.\\s*)*${identifier})`,
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
    updateText
      .slice(where.index + where[0].length)
      .split(/\bRETURNING\b/i, 1)[0]
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
      `\\bSELECT\\s+(?:(?:${identifier})\\s*\\.\\s*)?${stockColumn}\\s+INTO\\s+current_stock\\s+FROM\\s+${publicSchema}${legacyTable}(?:\\s+(?:AS\\s+)?${identifier})?\\s+WHERE\\b([\\s\\S]*?)\\bFOR\\s+UPDATE\\s*;?$`,
      'i'
    ).exec(text.trim());
    if (
      !select ||
      normalizedIdentifier(select[1]) !== target.table ||
      !serializedInventoryControlFlow.dominatesControlFlow(
        prefix,
        index + select.index,
        decrement.index
      )
    ) {
      continue;
    }
    const rowEquality = new RegExp(
      `(?:(?:${identifier})\\s*\\.\\s*)?id\\s*=\\s*${referencePattern(target.rowReference)}\\b`,
      'i'
    );
    if (!isRequiredConjunct(select[2], rowEquality)) continue;
    const afterLock = prefix.slice(index + text.length);
    const missingRowHandler =
      /^\s*IF\s+NOT\s+FOUND\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\b(?:RAISE\s+EXCEPTION|RETURN)\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
        afterLock
      );
    const shortageStart = missingRowHandler?.[0].length ?? 0;
    if (
      missingRowHandler &&
      new RegExp(
        `^\\s*IF\\s+current_stock\\s*<\\s*(?:\\(\\s*)*${quantity}\\b[\\s\\)]*\\s+THEN(?:(?!\\bEND\\s+IF\\b)[\\s\\S])*?\\bRETURN\\b`,
        'i'
      ).test(afterLock.slice(shortageStart))
    ) {
      return true;
    }
  }
  return false;
}
function legacyDecrementHasCompareAndSetGuard(statement) {
  const masked = maskNestedSql(maskSqlLiterals(statement));
  const where = [...masked.matchAll(/\bWHERE\b/gi)].at(-1);
  if (!where) return false;
  const decrement = stockDecrementMatch(masked);
  const update = decrement
    ? [...masked.matchAll(new RegExp(updatePattern.source, 'gi'))]
        .filter((candidate) => candidate.index <= decrement.index)
        .at(-1)
    : undefined;
  if (!update) return false;
  const quantity = decrementQuantityPattern(decrement);
  const target = referencePattern(update[2] ?? normalizedIdentifier(update[1]));
  const targetStock = `(?:${target}\\s*\\.\\s*${stockColumn}|(?<![A-Za-z0-9_."])${stockColumn})`;
  const comparison = new RegExp(
    `(?:\\(\\s*)*${targetStock}\\s*>=\\s*(?:\\(\\s*)*${quantity}\\b(?:\\s*\\))*|(?:\\(\\s*)*${quantity}\\s*<=\\s*(?:\\(\\s*)*${targetStock}(?:\\s*\\))*`,
    'i'
  );
  const whereClause = masked
    .slice(where.index + where[0].length)
    .split(/\bRETURNING\b/i, 1)[0];
  if (/\bFALSE\b|\bNOT\s+TRUE\b/i.test(whereClause)) return false;
  if (!requiredRowReference(whereClause)) return false;
  return (
    isRequiredConjunct(whereClause, comparison) ||
    matchingLockedPrecheck(masked, decrement)
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
