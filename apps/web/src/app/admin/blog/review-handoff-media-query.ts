// Picture <source> media values the validator can prove never match.
// Per Media Queries Level 5, `not all` matches no device and a
// syntactically invalid query evaluates as `not all`, so the browser
// skips such a source. Structural defects (unbalanced parentheses,
// unclosed quotes, bare brackets, empty groups) and provably false
// viewport-dimension conditions are detected here. Token-level
// grammar (combinator placement, feature names) and possibly
// matching values stay applicable: the validator has no viewport,
// and an over-eager skip would reject rendering articles.
import { evaluateDimensionAtom } from './review-handoff-media-query-dimension';

const MAX_CONDITION_DEPTH = 32;

function stripMediaComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function splitTopLevelQueries(value: string): string[] {
  // Commas inside quotes or groups do not separate queries.
  const queries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of value) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth <= 0) {
      queries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  queries.push(current);
  return queries;
}

function isProvablyInvalidQuery(query: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  // Whether each open group already holds non-whitespace content: an
  // empty pair can never form a valid condition.
  const groupHasContent: boolean[] = [];
  const markContent = () => {
    if (groupHasContent.length > 0) {
      groupHasContent[groupHasContent.length - 1] = true;
    }
  };
  for (const char of query) {
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      markContent();
      continue;
    }
    if (char === '(') {
      depth += 1;
      groupHasContent.push(false);
      continue;
    }
    if (char === ')') {
      if (depth === 0) return true;
      depth -= 1;
      if (!groupHasContent.pop()) return true;
      markContent();
      continue;
    }
    // Bare brackets appear nowhere in the query grammar outside
    // strings, so their presence fails the whole query.
    if (char === '[' || char === ']') return true;
    if (!/\s/.test(char)) markContent();
  }
  if (quote !== null) return true;
  return depth !== 0;
}

function isNeverMatchingQuery(query: string): boolean {
  if (query.trim().toLowerCase().replace(/\s+/g, ' ') === 'not all') {
    return true;
  }
  return isProvablyInvalidQuery(query) || isProvablyFalseCondition(query, 0);
}

function stripRedundantParens(condition: string): string {
  let trimmed = condition.trim();
  for (;;) {
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return trimmed;
    let depth = 0;
    let quote: string | null = null;
    let wrapsAll = true;
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (quote !== null) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0 && index < trimmed.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll || depth !== 0) return trimmed;
    trimmed = trimmed.slice(1, -1).trim();
  }
}

function splitTopLevelKeyword(condition: string, keyword: string): string[] {
  // Whole-word, depth- and quote-aware split for `and` / `or`.
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  const lower = condition.toLowerCase();
  for (let index = 0; index < condition.length; index += 1) {
    const char = condition[index];
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    const boundary =
      depth <= 0 &&
      lower.startsWith(keyword, index) &&
      (index === 0 || /\s/.test(condition[index - 1])) &&
      (index + keyword.length >= condition.length ||
        /\s/.test(condition[index + keyword.length]));
    if (boundary) {
      parts.push(current);
      current = '';
      index += keyword.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function evaluateMediaCondition(
  condition: string,
  depth: number
): 'false' | 'true' | 'other' {
  // Three-valued evaluation with `not` > `and` > `or` precedence. Only
  // proven-false conditions skip the source; anything else stays
  // applicable, including unknown features and deep nesting.
  if (depth > MAX_CONDITION_DEPTH) return 'other';
  const stripped = stripRedundantParens(condition);
  if (/^all$/i.test(stripped)) return 'true';
  const disjuncts = splitTopLevelKeyword(stripped, 'or');
  if (disjuncts.length > 1) {
    const values = disjuncts.map((part) =>
      evaluateMediaCondition(part, depth + 1)
    );
    if (values.every((value) => value === 'false')) return 'false';
    if (values.some((value) => value === 'true')) return 'true';
    return 'other';
  }
  const conjuncts = splitTopLevelKeyword(stripped, 'and');
  if (conjuncts.length > 1) {
    const values = conjuncts.map((part) =>
      evaluateMediaCondition(part, depth + 1)
    );
    if (values.some((value) => value === 'false')) return 'false';
    if (values.every((value) => value === 'true')) return 'true';
    return 'other';
  }
  const negation = /^\s*not\s+/i.exec(stripped);
  if (negation) {
    const inner = evaluateMediaCondition(
      stripped.slice(negation[0].length),
      depth + 1
    );
    if (inner === 'false') return 'true';
    if (inner === 'true') return 'false';
    return 'other';
  }
  const only = /^\s*only\s+/i.exec(stripped);
  if (only) {
    return evaluateMediaCondition(stripped.slice(only[0].length), depth + 1);
  }
  return evaluateDimensionAtom(stripped);
}

function isProvablyFalseCondition(query: string, depth: number): boolean {
  return evaluateMediaCondition(query, depth) === 'false';
}

/**
 * Whether a picture source media value provably never matches any
 * device. A list applies when any alternative could match, and an
 * empty list applies to all devices, so only a value whose every
 * query is `not all` or structurally invalid counts.
 */
export function isNeverMatchingMediaQuery(value: string): boolean {
  const queries = splitTopLevelQueries(stripMediaComments(value))
    .map((query) => query.trim())
    .filter((query) => query !== '');
  if (queries.length === 0) return false;
  return queries.every(isNeverMatchingQuery);
}
