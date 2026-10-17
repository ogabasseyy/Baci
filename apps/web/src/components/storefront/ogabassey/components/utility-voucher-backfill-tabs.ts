// History-tab classification for the utility voucher backfill loop.
//
// Split from `utility-voucher-backfill-model.ts` (Codex R112 P1 — one
// primary export per file): tab mapping is its own concern,
// independent of response parsing, terminality, and poll pacing.
export const TAB_TO_HISTORY_TYPE: Record<string, string> = {
  airtime: 'airtime',
  data: 'data',
  power: 'electricity',
  tv: 'cable_tv',
  betting: 'betting',
};

/** History types whose success may still gain a late token. */
export const TOKEN_BACKFILL_HISTORY_TYPES: ReadonlySet<string> = new Set([
  'electricity',
  'cable_tv',
  'betting',
]);

export function isUtilityBackfillTab(tab: string): boolean {
  return TAB_TO_HISTORY_TYPE[tab] !== undefined;
}

export function isTokenBackfillTab(tab: string): boolean {
  const historyType = TAB_TO_HISTORY_TYPE[tab];
  return (
    historyType !== undefined && TOKEN_BACKFILL_HISTORY_TYPES.has(historyType)
  );
}
