import { describe, expect, it } from 'vitest';
import {
  LAB_CARD_GEOMETRY,
  labCardSlot,
  labProductFixture,
  PILOT_LAB_FILLER_IMAGES,
  pilotLabFillerImageUrl,
} from './lab-fixtures';

describe('pilotLabFillerImageUrl', () => {
  it('resolves one frozen filler asset per sibling position', () => {
    expect(PILOT_LAB_FILLER_IMAGES).toEqual([
      '/__pilot/fillers/grid-filler-600x400-a.png',
      '/__pilot/fillers/grid-filler-600x400-b.png',
      '/__pilot/fillers/grid-filler-600x400-c.png',
    ]);
    expect(pilotLabFillerImageUrl('http://localhost:3000', 0)).toBe(
      'http://localhost:3000/__pilot/fillers/grid-filler-600x400-a.png'
    );
    expect(pilotLabFillerImageUrl('http://localhost:3000', 2)).toBe(
      'http://localhost:3000/__pilot/fillers/grid-filler-600x400-c.png'
    );
  });

  it('throws out of range instead of reusing one filler', () => {
    expect(() => pilotLabFillerImageUrl('http://localhost:3000', 3)).toThrow(
      /filler index 3 has no frozen asset/
    );
  });
});

describe('labCardSlot', () => {
  it('maps the mounted grid card to priority fetch semantics', () => {
    const product = labProductFixture({
      imageHint: 'card lab product',
      imageLarge: 'http://localhost:3000/__pilot/originals/card.png',
      name: 'Lab Product',
    });
    const slot = labCardSlot(product);
    expect(slot).toMatchObject({
      fetchPriority: 'high',
      height: LAB_CARD_GEOMETRY.height,
      loading: 'eager',
      sizes: LAB_CARD_GEOMETRY.sizes,
      width: LAB_CARD_GEOMETRY.width,
    });
    expect(slot.alt.length).toBeGreaterThan(0);
  });

  it('downgrades fetch semantics when priority is off', () => {
    const product = labProductFixture({
      imageHint: 'card lab product',
      imageLarge: 'http://localhost:3000/__pilot/originals/card.png',
      name: 'Lab Product',
    });
    const slot = labCardSlot(product, { priority: false });
    expect(slot.fetchPriority).toBe('low');
    expect(slot.loading).toBe('lazy');
  });
});

describe('labProductFixture', () => {
  it('fixes commerce fields and varies only the image', () => {
    const product = labProductFixture({
      imageHint: 'hint',
      imageLarge: 'http://localhost:3000/original.png',
      name: 'Lab Product',
    });
    expect(product).toMatchObject({
      id: 'lab-product-1',
      name: 'Lab Product',
      status: 'active',
      price: 2500,
      imageLarge: 'http://localhost:3000/original.png',
    });
    const filler = labProductFixture({
      id: 'lab-filler-2',
      imageHint: 'hint',
      imageLarge: 'http://localhost:3000/original.png',
      name: 'Lab Filler Two',
      price: 1800,
    });
    expect(filler.id).toBe('lab-filler-2');
    expect(filler.price).toBe(1800);
    expect(filler.imageLarge).toBe(product.imageLarge);
  });
});
