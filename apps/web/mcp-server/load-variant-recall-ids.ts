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
// Managed PostgREST clamps every response at 1,000 rows, so recall pages the
// window instead of requesting 2,001 rows that can never arrive complete.
const POSTGREST_MAX_ROWS = 1000;

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
  supabase: SupabaseClient,
  catalogFilters?: { brand?: string; category?: string; condition?: string }
): Promise<{ ids: string[]; truncated: boolean }> {
  // Branch identity rides along: alternatives are OR branches, so the RPC
  // must score each branch separately instead of counting exact matches
  // over the flattened set (a hybrid matching one constraint from each of
  // two branches must not tie a variant completing one branch).
  const constraints = (intent?.alternatives ?? []).flatMap((alternative, branch) =>
    (alternative.attributes ?? []).map((attribute) => ({ ...attribute, branch }))
  );
  if (constraints.length === 0) return { ids: [], truncated: false };
  const loadedRows: unknown[] = [];
  try {
    // product_variants is staff-only under RLS, so recall reads through the
    // published-merchant RPC instead of the table directly. Constraints ride
    // into the RPC so filtering precedes the cap; a matching variant past
    // the window would otherwise be unreachable to product-level search.
    // PostgREST clamps responses at 1,000 rows, so the 2,001-row probe pages
    // below the cap: two full pages, then a one-row probe at the window edge
    // discloses whether the RPC window cut the match set.
    const filters = constraints.map(({ key, operator, value, branch }) => ({ key, operator, value, branch }));
    // Intent-level excluded product types ride as their own argument: the RPC
    // sinks verified-excluded rows below every non-excluded row (the matcher
    // drops them on every branch), while unverified rows stay reachable.
    const excludedTypes = intent?.excluded_product_types ?? [];
    // Identity rides along per branch: without it the RPC ranks every
    // attribute-matching variant equally, so wrong-identity products can
    // fill the capped window ahead of the valid one. Only specified fields
    // ride; the RPC normalizes and ranks (verified first, unverified next,
    // contradicted last), never excludes.
    const identity = (intent?.alternatives ?? []).map((alternative, branch) => ({
      branch,
      ...(alternative.product_type === undefined ? {} : { product_type: alternative.product_type }),
      ...(alternative.brands === undefined ? {} : { brands: alternative.brands }),
      ...(alternative.model === undefined ? {} : { model: alternative.model }),
      ...(alternative.compatible_with === undefined ? {} : { compatible_with: alternative.compatible_with }),
    }));
    const fetchPage = async (limit: number, offset: number) => {
      const { data, error } = await supabase.rpc('search_product_variant_recall', {
        p_merchant_id: merchantId,
        p_filters: filters,
        p_identity: identity,
        p_excluded_types: excludedTypes,
        p_brand: catalogFilters?.brand,
        p_category: catalogFilters?.category,
        // Requested conditions ride in so the RPC narrows before the cap;
        // other-condition rows would otherwise crowd out the match.
        p_condition: catalogFilters?.condition,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    };
    const first = await fetchPage(POSTGREST_MAX_ROWS, 0);
    loadedRows.push(...first);
    if (first.length < POSTGREST_MAX_ROWS) {
      return collectRecallIds(first, false);
    }
    const second = await fetchPage(POSTGREST_MAX_ROWS, POSTGREST_MAX_ROWS);
    loadedRows.push(...second);
    const rows = [...first, ...second];
    if (rows.length < VARIANT_SCAN_LIMIT) {
      return collectRecallIds(rows, false);
    }
    const probe = await fetchPage(1, VARIANT_SCAN_LIMIT);
    return collectRecallIds(rows, probe.length > 0);
  } catch {
    return collectRecallIds(loadedRows, true);
  }

  function collectRecallIds(window: unknown[], truncated: boolean) {
    const ids = [...new Set(window.flatMap((row) => {
      const recordRow = record(row);
      const normalized = normalizeDiscoveryOptionAttributes(record(recordRow.attributes));
      return constraints.some((constraint) => variantSatisfies(normalized, constraint))
        ? [String(recordRow.product_id)] : [];
    }))];
    return { ids, truncated };
  }
}
