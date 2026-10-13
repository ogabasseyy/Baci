/** Fixed local airport-delivery fees used by every checkout surface. */
export const AIRPORT_DELIVERY_FEES = {
  delivery: 35_000,
  pickup: 20_000,
  /** Fee used by mobile builds released before airport metadata was added. */
  legacy: 25_000,
} as const;
