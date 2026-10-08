// Picture <source> media values the validator can prove never match.
// Per Media Queries Level 5, `not all` matches no device and a
// syntactically invalid query evaluates as `not all`, so the browser
// skips such a source. Only structural defects are detected here —
// unbalanced parentheses, unclosed quotes, bare brackets, and empty
// groups. Token-level grammar (combinator placement, feature names)
// and viewport-dependent values stay applicable: the validator has no
// viewport, and an over-eager skip would reject rendering articles.

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
  return isProvablyInvalidQuery(query);
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
