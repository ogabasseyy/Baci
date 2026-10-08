// Shared scan fixtures for the merchant-image-pilot readiness suites.
// Split out of the oversized readiness-checks suite so the focused
// mount/surface/coverage files stay under the 300-line ceiling. The suites
// never mutate these objects (they spread per-case overrides), so plain
// shared constants preserve the original in-describe semantics.
export const mount = {
  binding: 'merchant/logo-a',
  generationId: 'abc',
  merchantId: 'merchant',
  slotId: 'header-logo',
  stagedOriginal: '/__pilot/originals/x.png',
};

export const pilotImg = {
  box: { height: 40, width: 40, x: 8, y: 8 },
  complete: true,
  currentSrc: 'https://lab/__pilot/abc/x.avif',
  naturalHeight: 80,
  naturalWidth: 80,
  objectFit: 'cover',
};

export const goodSlot = {
  binding: 'merchant/logo-a',
  img: pilotImg,
  rect: { height: 40, width: 40, x: 8, y: 8 },
  slotId: 'header-logo',
  status: null,
};
