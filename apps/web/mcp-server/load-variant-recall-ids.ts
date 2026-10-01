import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { normalizeDiscoveryOptionAttributes } from './normalize-discovery-option-attributes';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';

// The serving search document indexes product fields and discovery_metadata,
// never product_variants, so a spec that lives only on a variant (256 GB on
// the variant, absent or 128 GB on the parent) would eliminate its own valid
// candidates. This recall source scans merchant variants with the same
// normalization the matcher uses, so option-level constraints stay reachable.
// Recall-oriented: constraints OR together because a variant may prove one
// constraint while the parent metadata proves another; the matcher enforces
// every constraint post-hydration. Range constraints stay with the fact
// source, which cannot express them at variant level either.
const VARIANT_SCAN_LIMIT = 2000;

type IntentAttribute = NonNullable<McpDiscoveryIntent['alternatives'][number]['attributes']>[number];
type EqualityConstraint = { key: IntentAttribute['key']; operator: 'eq'; value: string | number };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// Mirrors matchesAlternative's exclusion boundary for equality: undefined or
// malformed values stay recalled and let the matcher rule them unverified.
function variantSatisfies(attributes: Record<string, unknown>, constraint: EqualityConstraint) {
  const normalizedKey = constraint.key.trim().toLocaleLowerCase('en-US');
  const actual = attributes[normalizedKey] ?? attributes[constraint.key];
  if (actual === undefined || actual === null) return true;
  if (typeof constraint.value === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && actual === constraint.value;
  }
  const expected = structuredDiscoveryIdentity.normalizeText(constraint.value);
  return expected !== undefined && structuredDiscoveryIdentity.normalizeText(actual) === expected;
}

/** Product IDs with a variant satisfying any equality constraint, for specs
 * the product-level search document cannot see. */
export async function loadVariantRecallIds(
  intent: McpDiscoveryIntent | undefined,
  merchantId: string,
  supabase: SupabaseClient
): Promise<{ ids: string[]; truncated: boolean }> {
  const constraints = (intent?.alternatives ?? []).flatMap((alternative) => alternative.attributes ?? [])
    .filter((attribute): attribute is EqualityConstraint => attribute.operator === 'eq');
  if (constraints.length === 0) return { ids: [], truncated: false };
  try {
    const { data, error } = await supabase.from('product_variants')
      .select('product_id,attributes')
      .eq('merchant_id', merchantId)
      .range(0, VARIANT_SCAN_LIMIT);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).slice(0, VARIANT_SCAN_LIMIT);
    const truncated = Array.isArray(data) && data.length > VARIANT_SCAN_LIMIT;
    const ids = [...new Set(rows.flatMap((row) => {
      const recordRow = record(row);
      const normalized = normalizeDiscoveryOptionAttributes(record(recordRow.attributes));
      return constraints.some((constraint) => variantSatisfies(normalized, constraint))
        ? [String(recordRow.product_id)] : [];
    }))];
    return { ids, truncated };
  } catch {
    return { ids: [], truncated: true };
  }
}
