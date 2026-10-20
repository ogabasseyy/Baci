// Single source of truth for the merchant image pilot lab flag. Leaf
// module (no app imports): the lab loader, the public-asset startup
// gate, and the boot gate all read through here so the deployment
// refusal below cannot drift between readers.
export const PILOT_LAB_FLAG = 'BACI_IMAGE_PILOT_LAB';

// Exposure model: lab mode serves staged merchant bytes as ordinary
// static files under public/__pilot (originals at predictable
// <merchantId>-<assetId> names), bypassing every route gate — so the
// lab must never run on a reachable deployment. Any Vercel deployment
// blocks the lab unconditionally, including `development` (those URLs
// can be publicly reachable): the lab runs flag-local (no VERCEL_ENV)
// or on the operator's own standalone/VPS box, which acknowledges
// production exposure explicitly below.
export const PILOT_LAB_ALLOW_PROD_FLAG = 'BACI_IMAGE_PILOT_ALLOW_PROD';

export function isPilotLabEnabled(): boolean {
  if ((process.env.VERCEL_ENV ?? '') !== '') {
    return false;
  }
  // The repo's standalone/VPS flow is the default production runner
  // and sets no VERCEL_ENV: without this clause, copying the lab flag
  // onto production standalone would enable the lab and publicly
  // serve staged merchant bytes, bypassing the Vercel-only blocklist.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env[PILOT_LAB_ALLOW_PROD_FLAG] !== '1'
  ) {
    return false;
  }
  return process.env[PILOT_LAB_FLAG] === '1';
}
