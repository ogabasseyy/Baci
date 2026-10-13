import { describe, expect, it } from 'vitest';
import { buildProductContextSpecFacts } from './build-product-context-spec-facts';

describe('buildProductContextSpecFacts', () => {
  it('keeps scalar device facts while excluding relation metadata', () => {
    expect(
      buildProductContextSpecFacts(
        {
          created_at: '2026-06-01T00:00:00Z',
          ram_gb: 8,
          storage_gb: 256,
          has_5g: true,
        },
        'Smartphones'
      )
    ).toEqual(['5G Support: Yes', 'Internal Storage: 256GB', 'RAM: 8GB']);
  });

  it('filters unsupported generic facts but preserves safe gaming details', () => {
    expect(
      buildProductContextSpecFacts(
        {
          storage_gb: 0,
          chipset: 'AMD Ryzen 7',
          gpu: 'RTX 4060',
          platform: 'PlayStation 5',
          format: 'Physical Blu-ray disc',
          camera_score: 88,
          battery_score: 91,
          gaming_score: 95,
          has_dual_camera: true,
        },
        'PlayStation 5'
      )
    ).toEqual([
      'Processor: AMD Ryzen 7',
      'GPU: RTX 4060',
      'Format: Physical Blu-ray disc',
      'Platform: PlayStation 5',
    ]);
  });

  it('filters invalid mobile and computer measurement facts', () => {
    expect(
      buildProductContextSpecFacts(
        { storage_gb: 0, display_resolution: 'N/A', has_5g: false },
        'Smartphones'
      )
    ).toEqual(['5G Support: No']);
    expect(
      buildProductContextSpecFacts(
        { ram_gb: 0, display_resolution: 'N/A', chipset: 'Apple M4' },
        'Laptops'
      )
    ).toEqual(['Chipset: Apple M4']);
  });

  it('keeps verified cellular laptop facts in customer crawl copy', () => {
    const productKeySpecs = {
      has_5g: true,
      sim_type: 'eSIM',
      has_nfc: true,
    };

    const facts = buildProductContextSpecFacts(productKeySpecs, 'Laptops');

    expect(facts).toEqual(['5G Support: Yes', 'SIM: eSIM', 'NFC: Yes']);
  });

  it('uses mobile facts for a slug-only google-pixel context category', () => {
    expect(
      buildProductContextSpecFacts({ has_5g: true, ram_gb: 12 }, 'google-pixel')
    ).toEqual(['5G Support: Yes', 'RAM: 12GB']);
  });

  it('retains verified NFC in camera context facts', () => {
    expect(
      buildProductContextSpecFacts({ has_nfc: true }, 'Action Cameras')
    ).toEqual(['NFC: Yes']);
  });

  it('retains positive camera OIS while suppressing false and placeholder values', () => {
    const verifiedFacts = buildProductContextSpecFacts(
      { has_ois: true },
      'Action Cameras'
    );
    const negativeFacts = buildProductContextSpecFacts(
      { has_ois: false },
      'Action Cameras'
    );
    const placeholderFacts = buildProductContextSpecFacts(
      { has_ois: 'N/A' },
      'Action Cameras'
    );

    expect(verifiedFacts).toEqual(['OIS: Yes']);
    expect(negativeFacts).toEqual([]);
    expect(placeholderFacts).toEqual([]);
  });

  it('does not expose unknown measurements or capability placeholders in crawl facts', () => {
    for (const [category, productKeySpecs] of [
      [
        'Action Cameras',
        { display_resolution: 'Unknown', has_nfc: 'Unknown', has_ois: 'TBD' },
      ],
      [
        'Smartphones',
        { display_resolution: 'Unknown', has_nfc: 'Unknown', has_ois: 'N/A' },
      ],
      [
        'Laptops',
        { display_resolution: 'Unknown', has_nfc: 'Unknown', has_ois: 'N/A' },
      ],
    ] as const) {
      expect(buildProductContextSpecFacts(productKeySpecs, category)).toEqual(
        []
      );
    }
  });
  it('uses category priority rather than source object order before capping facts', () => {
    expect(
      buildProductContextSpecFacts(
        {
          dimensions_mm: '120 x 70 x 35 mm',
          weight_g: 450,
          build_materials: 'Magnesium alloy',
          display_type: 'LCD',
          screen_size_inches: 3,
          main_camera_mp: 24,
        },
        'Action Cameras'
      )
    ).toEqual([
      'Effective Resolution: 24MP',
      'Type: LCD',
      'Size: 3 inches',
      'Dimensions: 120 x 70 x 35 mm',
      'Weight: 450g',
    ]);
  });

  it('ranks OIS ahead of lifecycle metadata before capping mobile facts', () => {
    expect(
      buildProductContextSpecFacts(
        {
          ram_gb: 8,
          storage_gb: 256,
          battery_mah: 4000,
          has_5g: true,
          has_ois: true,
          announced_date: '2024-01-17',
          release_date: '2024-01-31',
        },
        'Smartphones'
      )
    ).toEqual([
      'OIS: Yes',
      '5G Support: Yes',
      'Internal Storage: 256GB',
      'RAM: 8GB',
      'Capacity: 4000mAh',
    ]);
  });

  it('preserves production recommendation arrays in crawl facts', () => {
    expect(
      buildProductContextSpecFacts(
        { recommended_for: ['Photography', 'Travel'] },
        'Smartphones'
      )
    ).toContain('Recommended for: Photography, Travel');
  });

  it('ranks recommendations before the five-fact cutoff for populated mobiles', () => {
    expect(
      buildProductContextSpecFacts(
        {
          ram_gb: 8,
          storage_gb: 256,
          battery_mah: 4000,
          has_5g: true,
          display_type: 'AMOLED',
          screen_size_inches: 6.7,
          recommended_for: ['Photography'],
        },
        'Smartphones'
      )
    ).toContain('Recommended for: Photography');
  });

  it('preserves production recommendation arrays for camera products', () => {
    expect(
      buildProductContextSpecFacts(
        { recommended_for: ['Photography', 'Travel'] },
        'Action Cameras'
      )
    ).toEqual(['Recommended for: Photography, Travel']);
  });

  it('preserves production recommendation arrays for general-family products', () => {
    expect(
      buildProductContextSpecFacts(
        { recommended_for: ['Gamers', 'Students'] },
        'Gaming'
      )
    ).toEqual(['Recommended for: Gamers, Students']);
  });

  it('preserves production recommendation arrays for computer-family products', () => {
    expect(
      buildProductContextSpecFacts(
        { recommended_for: ['Business users'] },
        'Laptops'
      )
    ).toEqual(['Recommended for: Business users']);
  });
});
