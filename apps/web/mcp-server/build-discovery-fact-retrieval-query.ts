import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';

const NUMERIC_UNITS: Record<string, string> = {
  storage_gb: 'GB', ram_gb: 'GB', power_w: 'W', screen_inches: 'inch', refresh_hz: 'Hz',
};

function sanitizeTerm(value: string): string {
  return value.replace(/[^a-zA-Z0-9.\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function attributeTerm(key: string, value: string | number): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return undefined;
    const unit = NUMERIC_UNITS[key];
    return unit ? `${value}${unit}` : String(value);
  }
  return sanitizeTerm(value) || undefined;
}

/** Retrieval text for the facts index, built from structured alternatives so
 * shopper wording never constrains candidate recall. Emitted ORs require
 * websearch_to_tsquery on the SQL side. Range bounds are omitted: retrieval
 * must not narrow on them, the matcher enforces ranges. */
export function buildDiscoveryFactRetrievalQuery(intent: McpDiscoveryIntent): string {
  const groups = intent.alternatives.map((alternative) => {
    const terms: string[] = [];
    if (alternative.product_type) terms.push(sanitizeTerm(alternative.product_type));
    const brands = (alternative.brands ?? []).map(sanitizeTerm).filter(Boolean);
    if (brands.length > 0) terms.push(brands.join(' OR '));
    if (alternative.model) terms.push(sanitizeTerm(alternative.model));
    if (alternative.compatible_with) terms.push(sanitizeTerm(alternative.compatible_with));
    for (const attribute of alternative.attributes ?? []) {
      if (attribute.operator !== 'eq') continue;
      const term = attributeTerm(attribute.key, attribute.value);
      if (term) terms.push(term);
    }
    return terms.filter(Boolean).join(' ');
  }).filter(Boolean);
  return groups.join(' OR ');
}
