import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { normalizeDiscoveryOptionAttributes } from './normalize-discovery-option-attributes';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';

// The serving search document indexes product fields and discovery_metadata,
// never product_variants, so a spec that lives only on a variant (256 GB on
// the variant, absent or 128 GB on the parent) would eliminate its own valid
// candidates. This recall source scans merchant variants with the same
// normalization and numeric comparison the matcher uses, so option-level
// constraints stay reachable. Recall-oriented: constraints OR together because
// a variant may prove one constraint while the parent metadata proves another;
// the matcher enforces every constraint post-hydration.
const VARIANT_SCAN_LIMIT = 2000;

type IntentAttribute = NonNullable<McpDiscoveryIntent['alternatives'][number]['attributes']>[number];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// Mirrors matchesAlternative's exclusion boundary: undefined or malformed
// values stay recalled and let the matcher rule them unverified; ranges use
// the same finite-numeric comparison.
function variantSatisfies(attributes: Record<string, unknown>, constraint: IntentAttribute) {
  const normalizedKey = constraint.key.trim().toLocaleLowerCase('en-US');
  const actual = attributes[normalizedKey] ?? attributes[constraint.key];
  if (actual === undefined || actual === null) return true;
  if (constraint.operator === 'eq') {
    if (typeof constraint.value !== 'number') {
      const expected = structuredDiscoveryIdentity.normalizeText(constraint.value);
      return expected !== undefined && structuredDiscoveryIdentity.normalizeText(actual) === expected;
    }
    return typeof actual === 'number' && Number.isFinite(actual) && actual === constraint.value;
  }
  if (typeof constraint.value !== 'number' || typeof actual !== 'number' ||
    !Number.isFinite(constraint.value) || !Number.isFinite(actual)) return false;
  return constraint.operator === 'gte' ? actual >= constraint.value : actual <= constraint.value;
}

/** Product IDs with a variant satisfying any equality constraint, for specs
 * the product-level search document cannot see. */
export async function loadVariantRecallIds(
  intent: McpDiscoveryIntent | undefined,
  merchantId: string,
  supabase: SupabaseClient
): Promise<{ ids: string[]; truncated: boolean }> {
  // Branch identity rides along: alternatives are OR branches, so the RPC
  // must score each branch separately instead of counting exact matches
  // over the flattened set (a hybrid matching one constraint from each of
  // two branches must not tie a variant completing one branch).
  const constraints = (intent?.alternatives ?? []).flatMap((alternative, branch) =>
    (alternative.attributes ?? []).map((attribute) => ({ ...attribute, branch }))
  );
  if (constraints.length === 0) return { ids: [], truncated: false };
  try {
    // product_variants is staff-only under RLS, so recall reads through the
    // published-merchant RPC instead of the table directly. Constraints ride
    // into the RPC so filtering precedes the cap; a matching variant past
    // the window would otherwise be unreachable to product-level search.
    const { data, error } = await supabase.rpc('search_product_variant_recall', {
      p_merchant_id: merchantId,
      p_filters: constraints.map(({ key, operator, value, branch }) => ({ key, operator, value, branch })),
      p_limit: VARIANT_SCAN_LIMIT + 1,
    });
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
