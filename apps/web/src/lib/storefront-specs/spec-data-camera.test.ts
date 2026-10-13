import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData camera families', () => {
  it('keeps camera PDPs on camera and legacy specification families', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      product_key_specs: {
        main_camera_mp: 45,
        screen_size_inches: 3,
        chipset: 'DIGIC X',
        has_5g: false,
        has_card_slot: false,
      },
      specifications: [
        {
          category: 'Imaging and recording',
          items: [
            { label: 'Sensor', value: '45MP full-frame CMOS' },
            { label: 'Video', value: '8K RAW' },
            { label: '5G Support', value: 'No' },
            { label: 'NFC', value: 'No' },
          ],
        },
        {
          category: 'Storage and media',
          items: [
            { label: 'Media', value: 'CFexpress Type B and UHS-II SD' },
            { label: 'Card Slot', value: 'N/A' },
          ],
        },
      ],
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Imaging and recording' }),
        expect.objectContaining({ category: 'Storage and media' }),
      ])
    );
    expect(result.detailedSpecs.map((section) => section.category)).not.toEqual(
      expect.arrayContaining(['Network', 'Platform', 'Memory', 'Sound'])
    );
    expect(
      result.detailedSpecs.flatMap((section) => section.items)
    ).not.toEqual(
      expect.arrayContaining([
        { label: '5G Support', value: 'No' },
        { label: 'Card Slot', value: 'No' },
        { label: 'NFC', value: 'No' },
        { label: 'Card Slot', value: 'N/A' },
      ])
    );
    expect(result.specs).toEqual(
      expect.arrayContaining([
        { label: 'Camera', value: '45MP full-frame CMOS' },
        { label: 'Storage', value: 'CFexpress Type B and UHS-II SD' },
      ])
    );
  });

  it('retains verified drone positioning in camera connectivity specs', () => {
    const result = buildProductSpecData({
      category: 'Drones',
      product_key_specs: { positioning: 'GPS / Galileo' },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Connectivity',
          items: [{ label: 'Positioning', value: 'GPS / Galileo' }],
        }),
      ])
    );
  });

  it('filters phone-only rows parsed from camera descriptions', () => {
    const result = buildProductSpecData({
      category: 'Drones',
      description:
        '<h2>Key Specs</h2><table><tr><td>5G Support</td><td>No</td></tr><tr><td>Sensor</td><td>1-inch CMOS</td></tr></table>',
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Key Specs',
        items: [{ label: 'Sensor', value: '1-inch CMOS' }],
      },
      {
        category: 'General',
        items: [
          { label: 'Brand', value: 'Generic' },
          { label: 'Condition', value: 'New' },
          { label: 'Category', value: 'Drones' },
        ],
      },
    ]);
  });

  it('drops persisted selfie-camera sections from camera PDP and comparison specs', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      specifications: [
        {
          category: 'Selfie Camera',
          items: [
            { label: 'Resolution', value: '12MP' },
            { label: 'Features', value: 'HDR' },
            { label: 'Video', value: '4K' },
          ],
        },
        {
          category: 'Imaging',
          items: [{ label: 'Sensor', value: 'APS-C CMOS' }],
        },
      ],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Imaging',
        items: [{ label: 'Sensor', value: 'APS-C CMOS' }],
      },
    ]);
    expect(result.specs).not.toEqual(
      expect.arrayContaining([
        { label: 'Resolution', value: '12MP' },
        { label: 'Features', value: 'HDR' },
        { label: 'Video', value: '4K' },
      ])
    );
  });

  it('keeps front-camera sections for dash cams', () => {
    const result = buildProductSpecData({
      category: 'Dash Cams',
      specifications: [
        {
          category: 'Front Camera',
          items: [{ label: 'Resolution', value: '4K' }],
        },
      ],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Front Camera',
        items: [{ label: 'Resolution', value: '4K' }],
      },
    ]);
  });

  it('builds safe camera key specs when legacy specifications are unavailable', () => {
    const result = buildProductSpecData({
      category: 'Action Cameras',
      product_key_specs: {
        main_camera_mp: 40,
        screen_size_inches: 2.5,
        display_type: 'OLED touchscreen',
        battery_mah: 1950,
        wifi_bands: 'Wi-Fi 6',
        usb_type: 'USB-C',
        has_5g: false,
        has_headphone_jack: false,
      },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Imaging',
          items: [{ label: 'Effective Resolution', value: '40MP' }],
        }),
        expect.objectContaining({
          category: 'Display',
          items: expect.arrayContaining([
            { label: 'Size', value: '2.5 inches' },
            { label: 'Type', value: 'OLED touchscreen' },
          ]),
        }),
        expect.objectContaining({
          category: 'Power',
          items: [{ label: 'Capacity', value: '1950mAh' }],
        }),
      ])
    );
    expect(result.detailedSpecs.map((section) => section.category)).not.toEqual(
      expect.arrayContaining(['Network', 'Platform', 'Memory', 'Sound'])
    );
    expect(result.specs).toEqual(
      expect.arrayContaining([
        { label: 'Display', value: '2.5 inches' },
        { label: 'Camera', value: '40MP' },
        { label: 'Battery', value: '1950mAh' },
      ])
    );
  });

  it('uses a slug-only camera join before stale legacy phone text', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      categories: { slug: 'action-cameras' },
      product_key_specs: {
        main_camera_mp: 40,
        has_5g: true,
      },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Imaging',
          items: [{ label: 'Effective Resolution', value: '40MP' }],
        }),
      ])
    );
    expect(result.detailedSpecs.map((section) => section.category)).not.toEqual(
      expect.arrayContaining(['Network'])
    );
  });

  it('skips placeholder category rows when selecting from a category array join', () => {
    const result = buildProductSpecData({
      category: 'Smartphones',
      categories: [{ slug: 'unknown' }, { slug: 'action-cameras' }],
      product_key_specs: {
        main_camera_mp: 40,
        has_5g: true,
      },
    });

    expect(result.detailedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'Imaging',
          items: [{ label: 'Effective Resolution', value: '40MP' }],
        }),
      ])
    );
    expect(result.detailedSpecs.map((section) => section.category)).not.toEqual(
      expect.arrayContaining(['Network'])
    );
  });

  it('includes camera internal storage in the summary when no card slot is present', () => {
    const result = buildProductSpecData({
      category: 'Instant Cameras',
      product_key_specs: {
        storage_gb: 8,
      },
    });

    expect(result.specs).toEqual(
      expect.arrayContaining([{ label: 'Storage', value: '8GB' }])
    );
  });

  it('filters legacy specs using joined category slug when display name is non-taxonomy', () => {
    const result = buildProductSpecData({
      categories: { name: '相机', slug: 'action-cameras' },
      specifications: [
        {
          category: 'Main Camera',
          items: [{ label: 'Main Camera', value: '48MP' }],
        },
      ],
    });

    expect(result.detailedSpecs).toEqual([
      {
        category: 'Main Camera',
        items: [{ label: 'Main Camera', value: '48MP' }],
      },
    ]);
  });

  it('prefers internal storage capacity over card slot type in summary specs', () => {
    const result = buildProductSpecData({
      category: 'Cameras',
      product_key_specs: {
        card_slot_type: 'CFexpress Type B',
        storage_gb: 64,
      },
      specifications: [
        {
          category: 'Storage',
          items: [
            { label: 'Card Slot', value: 'CFexpress Type B' },
            { label: 'Internal Storage', value: '64GB' },
          ],
        },
      ],
    });

    expect(result.specs).toContainEqual({ label: 'Storage', value: '64GB' });
  });
});
