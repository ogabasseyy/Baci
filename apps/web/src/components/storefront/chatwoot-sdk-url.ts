/**
 * The chat engine serves `sdk.js` with a one-year cache lifetime and the file
 * name never changes, so a shopper who loaded it once would keep that copy
 * after the engine is rebuilt. Stamping the UTC day gives the browser a new URL
 * once a day, with no storefront release needed after an engine update.
 */
export function chatwootSdkUrl(
  platformOrigin: string,
  now: Date = new Date()
): string {
  const utcDay = now.toISOString().slice(0, 10);
  return `${platformOrigin}/packs/js/sdk.js?v=${utcDay}`;
}
