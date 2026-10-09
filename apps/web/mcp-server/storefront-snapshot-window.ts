// Storefront snapshot variant window (pdp_core_slug_case_insensitive): the
// PDP snapshot retains 128 variants by (default, price, created, id) and
// refuses truncated products as unavailable with no full-RPC fallback. The
// variant RPCs mirror the contract server-side with LIMIT 129 — the 129th
// row is the truncation sentinel, never a selectable option.
export const STOREFRONT_SNAPSHOT_VARIANT_WINDOW = 128;
