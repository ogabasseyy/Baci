// Storefront snapshot windows (pdp_core_slug_case_insensitive): the PDP
// snapshot retains 16 offers by (condition, id) and 128 variants by
// (default, price, created, id), refusing truncated products as
// unavailable with no full-RPC fallback. Consumers must window before
// reasoning, or they advertise selection the PDP cannot present.
export const STOREFRONT_SNAPSHOT_OFFER_WINDOW = 16;
export const STOREFRONT_SNAPSHOT_VARIANT_WINDOW = 128;
