import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData camera precomputed specs', () => {
  it('filters stale phone rows from precomputed camera summary specs', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      specs: [
        { label: 'SIM', value: 'Nano-SIM' },
        { label: 'Card Slot', value: 'Not listed by manufacturer' },
        { label: 'Sensor', value: 'Full-frame CMOS' },
      ],
    });

    expect(result.specs).toEqual([
      { label: 'Sensor', value: 'Full-frame CMOS' },
    ]);
  });

  it('retains verified audio key specs for camera PDPs', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      product_key_specs: {
        has_stereo_speakers: true,
        has_headphone_jack: true,
      },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Sound',
        items: [
          { label: 'Loudspeaker', value: 'Yes, with stereo speakers' },
          { label: '3.5mm Jack', value: 'Yes' },
        ],
      },
    ]);
  });

  it('retains verified NFC connectivity for camera PDPs', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      product_key_specs: { has_nfc: true },
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Connectivity',
        items: [{ label: 'NFC', value: 'Yes' }],
      },
    ]);
  });
});
