import { describe, expect, it } from 'vitest';
import { buildFeedDescription } from './build-feed-description';

describe('buildFeedDescription', () => {
  it('keeps standalone merchandising colour for categorized accessories', () => {
    expect(
      buildFeedDescription({
        name: 'Protective Phone Case',
        category: 'Phone Cases',
        color: 'Midnight Blue',
        variant_attributes: { color: 'Coral Red' },
      })
    ).toContain('Colour: Coral Red');
  });

  it('keeps shipping weight for categorized accessories', () => {
    expect(
      buildFeedDescription({
        name: 'Protective Phone Case',
        category: 'Phone Cases',
        weight_unit: 'g',
        weight_value: 45,
      })
    ).toContain('Weight: 45g');
  });

  it('omits zero shipping weights from feed descriptions', () => {
    expect(
      buildFeedDescription({
        name: 'Protective Phone Case',
        category: 'Phone Cases',
        weight_unit: 'kg',
        weight_value: 0,
      })
    ).not.toContain('Weight: 0kg');
  });

  it('appends the key phone specs Merchant Center flagged as missing', () => {
    const description = buildFeedDescription({
      name: 'iPhone 17 Pro Max',
      category: 'Smartphones',
      description: '<p>Flagship iPhone with fast performance.</p>',
      color: 'Black Titanium',
      product_key_specs: {
        screen_size_inches: 6.9,
        display_resolution: '1320 x 2868',
        ram_gb: 12,
        storage_gb: 256,
        main_camera_mp: 48,
        front_camera_mp: 12,
        weight_g: 227,
      },
    });

    expect(description).toContain('Flagship iPhone with fast performance.');
    expect(description).toContain('Colour: Black Titanium');
    expect(description).toContain('Screen size: 6.9 inches');
    expect(description).toContain('Screen resolution: 1320 x 2868');
    expect(description).toContain('RAM: 12GB');
    expect(description).toContain('Storage capacity: 256GB');
    expect(description).toContain('Rear camera resolution: 48MP');
    expect(description).toContain('Front camera resolution: 12MP');
    expect(description).toContain('Weight: 227g');
  });

  it('front-loads missing Merchant Center key details before long prose', () => {
    const description = buildFeedDescription({
      name: 'iPhone 14',
      description:
        "iPhone 14 is Apple's standard 2022 iPhone for buyers who want a compact OLED phone with A15 Bionic performance, 5G and improved camera processing. This open-box page explains the model family, software support and checkout expectations before listing technical specifications.",
      color: 'Purple',
      product_key_specs: {
        screen_size_inches: 6.1,
        display_resolution: '2532 x 1170',
        ram_gb: 6,
        storage_gb: 128,
        main_camera_mp: 12,
        front_camera_mp: 12,
        weight_g: 172,
      },
    });

    const baseDescriptionStart = description.indexOf(
      "iPhone 14 is Apple's standard"
    );

    expect(description).toMatch(/^Key details: /);
    expect(description.indexOf('Key details:')).toBeLessThan(
      baseDescriptionStart
    );
    expect(description.indexOf('Screen resolution: 2532 x 1170')).toBeLessThan(
      baseDescriptionStart
    );
    expect(description.indexOf('RAM: 6GB')).toBeLessThan(baseDescriptionStart);
  });

  it('falls back to the product name when no base description exists', () => {
    const description = buildFeedDescription({
      name: 'Galaxy S26',
      description: '',
      product_key_specs: {
        ram_gb: 8,
      },
    });

    expect(description).toBe('Key details: RAM: 8GB. Galaxy S26.');
  });

  it('removes feed-only price and checkout boilerplate before enrichment', () => {
    const description = buildFeedDescription({
      name: 'iPhone 13',
      description:
        'iPhone 13 is a smartphone listed by Ogabassey with A15 Bionic and 5G support. Current listed price is NGN 460,000. Confirm selected variant price, colour, storage, device condition, and live availability before checkout.',
      color: 'Midnight',
      product_key_specs: {
        ram_gb: 4,
        storage_gb: 256,
      },
    });

    expect(description).not.toContain('Current listed price');
    expect(description).not.toContain('Confirm selected variant price');
    expect(description).toContain(
      'iPhone 13 is a smartphone listed by Ogabassey'
    );
    expect(description).toContain('RAM: 4GB');
  });

  it('preserves Merchant Center-supported paragraph breaks while removing feed boilerplate', () => {
    const description = buildFeedDescription({
      name: 'iPhone 13',
      description:
        'First paragraph with product details.\n\nCurrent listed price is NGN 460,000\nSecond paragraph stays separate. Confirm selected variant price, color, storage, device condition, and live availability before checkout',
      product_key_specs: {
        ram_gb: 4,
      },
    });

    expect(description).toContain(
      'First paragraph with product details.\n\nSecond paragraph stays separate.'
    );
    expect(description).not.toContain('Current listed price');
    expect(description).not.toContain('Confirm selected variant price');
    expect(description).toMatch(/^Key details: RAM: 4GB\. /);
  });

  it('does not append duplicate detail strings already present in the base description', () => {
    const description = buildFeedDescription({
      name: 'Pixel Ultra',
      description:
        'Pixel Ultra with Colour: Black and RAM: 16GB for demanding workflows.',
      color: 'Black',
      product_key_specs: {
        ram_gb: 16,
      },
    });

    expect(description).toBe(
      'Pixel Ultra with Colour: Black and RAM: 16GB for demanding workflows.'
    );
  });

  it('prefers variant matrix colour, RAM and storage over product-level values', () => {
    const description = buildFeedDescription({
      name: 'Galaxy S24 Ultra',
      category: 'Smartphones',
      description: 'Open box Samsung flagship with a large AMOLED display.',
      color: 'Titanium Black',
      product_key_specs: {
        ram_gb: 12,
        storage_gb: 256,
        main_camera_mp: 200,
      },
      variant_attributes: {
        color: 'Titanium Yellow',
        ram: '12GB',
        storage: '1TB',
      },
    });

    expect(description).toContain('Colour: Titanium Yellow');
    expect(description).toContain('RAM: 12GB');
    expect(description).toContain('Storage capacity: 1TB');
    expect(description).toContain('Rear camera resolution: 200MP');
    expect(description).not.toContain('Colour: Titanium Black');
    expect(description).not.toContain('Storage capacity: 256GB');
  });

  it('uses category-aware acceptance and rejects contaminated feed facts', () => {
    const description = buildFeedDescription({
      name: 'Action Camera',
      description: 'Compact camera for outdoor recording.',
      category: 'Cameras',
      product_key_specs: {
        display_resolution: 'N/A',
        ram_gb: 0,
        storage_gb: 0,
        main_camera_mp: 24,
        front_camera_mp: 12,
      },
      variant_attributes: { ram: 'N/A', storage: '0GB' },
    });

    expect(description).toContain('Rear camera resolution: 24MP');
    expect(description).not.toContain('Screen resolution: N/A');
    expect(description).not.toContain('RAM:');
    expect(description).not.toContain('Storage capacity:');
    expect(description).not.toContain('Front camera resolution:');
  });

  it('skips unknown details and invalid leading RAM and storage aliases', () => {
    const description = buildFeedDescription({
      name: 'Galaxy S24 Ultra',
      category: 'Smartphones',
      description: 'Samsung flagship.',
      product_key_specs: {
        display_resolution: 'Unknown',
        ram_gb: 8,
        storage_gb: 256,
      },
      variant_attributes: {
        memory: 'N/A',
        ram: '16GB',
        storage: 'Unknown',
        rom: '1TB',
      },
    });

    expect(description).toContain('RAM: 16GB');
    expect(description).toContain('Storage capacity: 1TB');
    expect(description).not.toContain('Screen resolution: Unknown');
    expect(description).not.toContain('RAM: 8GB');
    expect(description).not.toContain('Storage capacity: 256GB');
  });
});
