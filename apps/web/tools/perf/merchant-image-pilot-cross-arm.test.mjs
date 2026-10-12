import { describe, expect, it } from 'vitest';
import { crossArmProblems } from './merchant-image-pilot-readiness-checks.mjs';

describe('mounted image geometry parity', () => {
  const box = { x: 8, y: 8, width: 40, height: 40 };
  const mount = { binding: 'store/logo', slotId: 'header-logo' };
  const geometry = (imageBox = box) => ({
    selected: box,
    slots: [
      {
        binding: mount.binding,
        rect: { ...box, width: 390 },
        img: { box: imageBox },
        slotId: mount.slotId,
      },
    ],
  });
  it.each([
    'x',
    'y',
    'width',
    'height',
  ])('rejects image %s changes inside an unchanged header', (key) => {
    expect(
      crossArmProblems(geometry(), geometry({ ...box, [key]: box[key] + 10 }), [
        mount,
      ])
    ).toContain('slot "header-logo" image boxes differ between arms');
  });
  it('rejects missing image geometry', () => {
    expect(crossArmProblems(geometry(), geometry(null), [mount])).toContain(
      'slot "header-logo" missing image geometry for cross-arm comparison'
    );
  });
  it('accepts identical images including intentionally hidden mounts', () => {
    expect(crossArmProblems(geometry(), geometry(), [mount])).toEqual([]);
    const hidden = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      crossArmProblems(geometry(hidden), geometry(hidden), [mount])
    ).toEqual([]);
  });
  it('rejects a crop-mode change inside identical boxes', () => {
    // Same image box on both arms, but the pilot paints contain where
    // the control paints cover: the visible logo crop differs while
    // decode, resolution, and box checks all pass.
    const withFit = (fit) => ({
      selected: box,
      slots: [
        {
          binding: mount.binding,
          rect: { ...box, width: 390 },
          img: { box: { ...box }, objectFit: fit },
          slotId: mount.slotId,
        },
      ],
    });
    expect(
      crossArmProblems(withFit('cover'), withFit('cover'), [mount])
    ).toEqual([]);
    expect(
      crossArmProblems(withFit('cover'), withFit('contain'), [mount])
    ).toContain(
      'slot "header-logo" object-fit differs between arms (control cover, pilot contain)'
    );
  });
  it('refuses to compare a binding rendered under different slots', () => {
    // Same binding, same boxes — but the pilot renders under another
    // slot: equating the two would bless unaccepted geometry, so the
    // accepted slot reads as missing on the diverged arm instead.
    const moved = geometry();
    moved.slots[0].slotId = 'footer-logo';
    expect(crossArmProblems(geometry(), moved, [mount])).toEqual([
      'slot "header-logo" missing geometry for cross-arm comparison',
    ]);
  });
});
