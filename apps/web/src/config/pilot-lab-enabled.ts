// Single source of truth for the merchant image pilot lab flag. Leaf
// module (no app imports): the lab loader, the public-asset startup
// gate, and the boot gate all read through here so the deployment
// refusal below cannot drift between readers.
export const PILOT_LAB_FLAG = 'BACI_IMAGE_PILOT_LAB';

// Vercel environments where lab mode must never activate, even with the
// flag set: staged merchant bytes under public/__pilot are served as
// ordinary static assets, so a flag value copied onto a shared
// deployment would publicly expose them. Only flag-local runs (no
// VERCEL_ENV) and Vercel development can enable the lab.
const LAB_BLOCKED_VERCEL_ENVS = new Set(['production', 'preview']);

// Explicit acknowledgement for the standalone/VPS production case
// below: deliberate, auditable, and never copied by accident with the
// lab flag (or its env file) alone.
export const PILOT_LAB_ALLOW_PROD_FLAG = 'BACI_IMAGE_PILOT_ALLOW_PROD';

export function isPilotLabEnabled(): boolean {
  if (LAB_BLOCKED_VERCEL_ENVS.has(process.env.VERCEL_ENV ?? '')) {
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
