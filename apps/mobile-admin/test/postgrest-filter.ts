/**
 * Evaluates a PostgREST `or=` filter group against a plain row, so tests can
 * assert which orders a filter keeps instead of matching filter text.
 *
 * Supports the forms the admin order filters use: nested `and(...)` /
 * `or(...)`, and `eq`, `lt`, `in`, `not.in`, `is.null`, `not.is.null`.
 * Comparisons follow SQL NULL rules: a NULL column matches only `is.null`.
 */
export type FilterRow = Record<string, string | null | undefined>;

function splitTopLevel(group: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of group) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function unwrapList(operand: string): string[] {
  return operand.replace(/^\(|\)$/g, '').split(',');
}

function evaluateCondition(row: FilterRow, condition: string): boolean {
  const logical = /^(and|or)\((.*)\)$/.exec(condition);
  if (logical) {
    const children = splitTopLevel(logical[2]);
    return logical[1] === 'and'
      ? children.every((child) => evaluateCondition(row, child))
      : children.some((child) => evaluateCondition(row, child));
  }

  const firstDot = condition.indexOf('.');
  const column = condition.slice(0, firstDot);
  const rest = condition.slice(firstDot + 1);
  const value = row[column] ?? null;

  if (rest === 'is.null') return value === null;
  if (rest === 'not.is.null') return value !== null;
  if (value === null) return false;
  if (rest.startsWith('not.in.')) {
    return !unwrapList(rest.slice('not.in.'.length)).includes(value);
  }
  if (rest.startsWith('in.')) {
    return unwrapList(rest.slice('in.'.length)).includes(value);
  }
  if (rest.startsWith('eq.')) return value === rest.slice('eq.'.length);
  if (rest.startsWith('lt.')) return value < rest.slice('lt.'.length);
  throw new Error(`unsupported PostgREST condition: ${condition}`);
}

/** True when the row satisfies the comma-separated `or=` group. */
export function matchesOrFilter(row: FilterRow, orGroup: string): boolean {
  return splitTopLevel(orGroup).some((condition) =>
    evaluateCondition(row, condition)
  );
}
