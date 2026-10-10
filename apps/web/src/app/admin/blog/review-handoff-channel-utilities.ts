// Bare utilities that read or flip a hiding channel, hiding and
// showing alike: an unknown variant on `block` can show below an
// arbitrary threshold what the bare `hidden` conceals, so showing
// overrides reject exactly like hiding ones. Shared by the variance
// gate and the disallowed-wrapper check: sanitization unwraps
// non-allowlisted tags and drops their classes, so any channel
// marker on such a tag evaluates differently after the lossy step.
const CHANNEL_EXACT_UTILITIES = new Set([
  'hidden',
  'visible',
  'invisible',
  'collapse',
  'sr-only',
  'not-sr-only',
  'bg-clip-text',
  'truncate',
  'block',
  'inline-block',
  'inline',
  'flow-root',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'contents',
  'table',
  'inline-table',
  'table-caption',
  'table-cell',
  'table-column',
  'table-column-group',
  'table-footer-group',
  'table-header-group',
  'table-row-group',
  'table-row',
  'list-item',
  'scale-0',
  'scale-x-0',
  'scale-y-0',
  'w-0',
  'h-0',
  'size-0',
]);

const CHANNEL_UTILITY_PREFIXES = [
  'opacity-',
  'text-',
  'overflow-',
  'line-clamp-',
];

/**
 * Whether a bare class utility reads or flips a hiding channel.
 * Callers strip variant prefixes and the important modifier first.
 */
export function isChannelUtility(utility: string): boolean {
  if (CHANNEL_EXACT_UTILITIES.has(utility)) return true;
  return CHANNEL_UTILITY_PREFIXES.some((prefix) => utility.startsWith(prefix));
}
