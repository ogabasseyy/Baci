// Mounted-crop parsing for the pilot quality sheet, split from
// quality-sheet-render.mjs under the repo line ceiling.
export class PilotSheetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotSheetError';
  }
}

// Mounted-crop contract: cropped consumers (product card 16:9 cover,
// header logo circular cover) clip content the intrinsic-aspect render
// hides, so a sheet that ignores the mount can certify an image whose
// branding the real mount cuts off. The slot geometry may carry the
// mount box — { aspectRatio: '16 / 9', fit: 'cover', position: '50% 50%' }
// — and both original and derivatives then render inside that real CSS
// box at the row's size-matched width. Malformed mounts fail closed: a
// silently misrendered mount is worse than no sheet.
const MOUNT_FITS = new Set(['cover', 'contain']);
const MOUNT_POSITION_PATTERN =
  /^(center|left|right|top|bottom|\d{1,3}%)( (center|left|right|top|bottom|\d{1,3}%))?$/;

// Canonical mounts for fixed-geometry cropped slots, mirroring the lab
// consumers (keep in sync with the cited components): the product card
// paints aspect-video object-cover, the header logo a 40x40 rounded-full
// object-cover box (1/1 cover is its crop equivalent). Slots without an
// entry keep the legacy intrinsic render when --slots omits the mount —
// mobile-hero-slide-0 is deliberately absent (its fit is data-driven,
// contain or cover per projection, so no single canonical mount fits).
// An explicit --slots mount always wins over the canonical default.
const CANONICAL_SLOT_MOUNTS = {
  // apps/web/src/lib/merchant-image-variant-pilot/lab-product-card-image.tsx
  'product-card': { aspectRatio: '16 / 9', fit: 'cover', position: '50% 50%' },
  // apps/web/src/lib/merchant-image-variant-pilot/lab-header-logo.tsx
  'header-logo': { aspectRatio: '1 / 1', fit: 'cover', position: '50% 50%' },
};

const HORIZONTAL_KEYWORDS = new Set(['left', 'right']);
const VERTICAL_KEYWORDS = new Set(['top', 'bottom']);

// Axis compatibility for two-token positions (CSS <position-two>):
// keyword pairs must span both axes in either order (`top left`
// swaps, `left right` is invalid), while a percent locks its slot
// (first is horizontal, second vertical), so `50% left` and
// `top 50%` are invalid too. `center` is axis-neutral. An invalid
// pair would drop the declaration (centered crop) while the caption
// claims the supplied position — fail closed instead.
function assertPositionAxes(position, fail) {
  const tokens = position.split(' ');
  if (tokens.length !== 2) {
    return;
  }
  const [first, second] = tokens;
  const firstH = HORIZONTAL_KEYWORDS.has(first);
  const firstV = VERTICAL_KEYWORDS.has(first);
  const secondH = HORIZONTAL_KEYWORDS.has(second);
  const secondV = VERTICAL_KEYWORDS.has(second);
  if (
    (firstH && secondH) ||
    (firstV && secondV) ||
    (first.endsWith('%') && secondH) ||
    (firstV && second.endsWith('%'))
  ) {
    fail(
      `position "${position}" mixes incompatible axes (two keywords must span horizontal and vertical; a percent locks its slot)`
    );
  }
}

export function parseMountCrop(geometry, slot) {
  let mount = geometry?.mount;
  if (mount === undefined) {
    mount = CANONICAL_SLOT_MOUNTS[slot];
  }
  if (mount === undefined) {
    return null;
  }
  const fail = (why) => {
    throw new PilotSheetError(`invalid mount for slot "${slot}": ${why}`);
  };
  if (typeof mount !== 'object' || mount === null || Array.isArray(mount)) {
    fail('mount must be an object');
  }
  const ratio = /^(\d{1,4})\s*\/\s*(\d{1,4})$/.exec(mount.aspectRatio ?? '');
  if (!ratio || Number(ratio[1]) < 1 || Number(ratio[2]) < 1) {
    fail('aspectRatio must look like "16 / 9"');
  }
  if (!MOUNT_FITS.has(mount.fit)) {
    fail('fit must be "cover" or "contain"');
  }
  if (
    typeof mount.position !== 'string' ||
    !MOUNT_POSITION_PATTERN.test(mount.position)
  ) {
    fail('position must be CSS position keywords or percents');
  }
  assertPositionAxes(mount.position, fail);
  return {
    aspectRatio: `${ratio[1]} / ${ratio[2]}`,
    boxAspect: Number(ratio[1]) / Number(ratio[2]),
    fit: mount.fit,
    position: mount.position,
  };
}
