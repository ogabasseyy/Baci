/**
 * Model family alias tokens recognized across product model identifier extraction
 * and exclusion matching.
 */
export const MODEL_FAMILY_ALIAS_TOKENS = new Set([
  'airpods',
  'alienware',
  'aorus',
  'blade',
  'buds',
  'crosshair',
  'fire',
  'inspiron',
  'katana',
  'laserjet',
  'latitude',
  'legion',
  'nitro',
  'omen',
  'optiplex',
  'pavilion',
  'predator',
  'quest',
  'raider',
  'redmi',
  'rog',
  'series',
  'stealth',
  'thinkpad',
  'titan',
  'tuf',
  'vector',
  'watch',
  'xps',
]);

/**
 * Model family alias tokens that are allowed to co-occur with numeric model tiers.
 */
export const NUMERIC_MODEL_FAMILY_ALIAS_TOKENS = new Set([
  'fire',
  'omen',
  'optiplex',
]);
