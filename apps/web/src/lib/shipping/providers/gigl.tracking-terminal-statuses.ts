// Not the full "final" definition: `failed` is deliberately excluded (a later
// MSHC retry may follow a failed attempt) and SDR ("Shipment Destroyed") is
// special-cased in gigl.tracking-status-rank.ts and the lifecycle guards.
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'delivered',
  'returned',
  'cancelled',
]);
