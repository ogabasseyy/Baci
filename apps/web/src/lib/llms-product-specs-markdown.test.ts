import { describe, expect, it } from 'vitest';
import { buildProductKeySpecsSection } from './llms-product-specs-markdown';

describe('buildProductKeySpecsSection', () => {
  it('formats production-shaped product_key_specs fields with units', () => {
    expect(
      buildProductKeySpecsSection({
        chipset: 'Apple A19 Pro',
        ram_gb: 12,
        storage_gb: 256,
        screen_size_inches: 6.9,
        display_type: 'LTPO Super Retina XDR OLED',
        battery_mah: 4685,
        main_camera_mp: 48,
        front_camera_mp: 18,
        gpu: 'Apple GPU (6-core)',
        android_version: 'iOS 19',
        network_technology: 'GSM / HSPA / LTE / 5G',
        sim_type: 'Dual eSIM',
        warranty: '1 Year Apple Care',
      })
    ).toEqual([
      '## Key Specifications',
      '- Processor: Apple A19 Pro',
      '- RAM: 12GB',
      '- Storage: 256GB',
      '- Display Size: 6.9 inches',
      '- Display Type: LTPO Super Retina XDR OLED',
      '- Battery: 4685mAh',
      '- Main Camera: 48MP',
      '- Front Camera: 18MP',
      '- Graphics: Apple GPU \\(6\\-core\\)',
      '- Operating System: iOS 19',
      '- Network: GSM / HSPA / LTE / 5G',
      '- SIM: Dual eSIM',
      '- Warranty: 1 Year Apple Care',
      '',
    ]);
  });

  it('supports legacy fallback keys and avoids duplicating units when already present', () => {
    expect(
      buildProductKeySpecsSection({
        processor: 'Snapdragon 8 Elite',
        ram_gb: '16GB',
        display_size_inches: '6.8 inches',
        os: 'Android 16',
        network: '5G',
      })
    ).toEqual([
      '## Key Specifications',
      '- Processor: Snapdragon 8 Elite',
      '- RAM: 16GB',
      '- Display Size: 6.8 inches',
      '- Operating System: Android 16',
      '- Network: 5G',
      '',
    ]);
  });

  it('returns an empty list when specs are missing or contain only blank values', () => {
    expect(buildProductKeySpecsSection(null)).toEqual([]);
    expect(buildProductKeySpecsSection(undefined)).toEqual([]);
    expect(
      buildProductKeySpecsSection({
        chipset: '   ',
        ram_gb: null,
        storage_gb: undefined,
      })
    ).toEqual([]);
  });
});
