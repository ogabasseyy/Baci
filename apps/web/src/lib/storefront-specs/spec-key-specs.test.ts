import { describe, expect, it } from 'vitest';
import { buildDetailedSpecsFromKeySpecs } from './spec-key-specs';

describe('buildDetailedSpecsFromKeySpecs', () => {
  it('uses the camera taxonomy without phone-only sections', () => {
    const sections = buildDetailedSpecsFromKeySpecs(
      {
        main_camera_mp: 20,
        has_5g: false,
      },
      'camera'
    );

    expect(sections).toEqual([
      {
        category: 'Imaging',
        items: [{ label: 'Effective Resolution', value: '20MP' }],
      },
    ]);
  });

  it('omits unsupported general values while retaining safe console hardware specs', () => {
    const sections = buildDetailedSpecsFromKeySpecs(
      {
        chipset: 'AMD Zen 2',
        gpu: 'RDNA 2',
        storage_gb: 825,
        battery_mah: 0,
      },
      'general',
      'Gaming'
    );

    expect(sections).toEqual(
      expect.arrayContaining([
        {
          category: 'Processing',
          items: [
            { label: 'Processor', value: 'AMD Zen 2' },
            { label: 'GPU', value: 'RDNA 2' },
          ],
        },
        {
          category: 'Memory',
          items: [{ label: 'Internal Storage', value: '825GB' }],
        },
      ])
    );
    expect(sections.flatMap((section) => section.items)).not.toEqual(
      expect.arrayContaining([{ label: 'Capacity', value: '0mAh' }])
    );
  });

  it('omits camera card-slot placeholders from the camera projection', () => {
    const sections = buildDetailedSpecsFromKeySpecs(
      { card_slot_type: 'N/A', storage_gb: 8 },
      'camera'
    );

    expect(sections).toEqual([
      {
        category: 'Storage',
        items: [{ label: 'Internal Storage', value: '8GB' }],
      },
    ]);
  });

  it('omits zero and placeholder measurements from every device family', () => {
    const cameraSections = buildDetailedSpecsFromKeySpecs(
      {
        main_camera_mp: 0,
        screen_size_inches: 0,
        storage_gb: 0,
        battery_mah: 0,
        display_type: 'LCD',
      },
      'camera'
    );
    const mobileSections = buildDetailedSpecsFromKeySpecs(
      { storage_gb: 0, battery_mah: 0, display_resolution: 'N/A' },
      'mobile'
    );
    const computerSections = buildDetailedSpecsFromKeySpecs(
      { ram_gb: 0, screen_size_inches: 0, display_resolution: 'N/A' },
      'computer'
    );

    expect(cameraSections).toEqual([
      {
        category: 'Display',
        items: [{ label: 'Type', value: 'LCD' }],
      },
    ]);
    expect(mobileSections).toEqual([]);
    expect(computerSections).toEqual([]);
  });

  it('retains explicit negative capability facts by field', () => {
    expect(
      buildDetailedSpecsFromKeySpecs(
        { has_5g: false, has_headphone_jack: false },
        'mobile'
      )
    ).toEqual(
      expect.arrayContaining([
        {
          category: 'Network',
          items: [{ label: '5G Support', value: 'No' }],
        },
        {
          category: 'Sound',
          items: [{ label: '3.5mm Jack', value: 'No' }],
        },
      ])
    );
  });

  it('does not turn truthy capability strings into positive mobile facts', () => {
    const sections = buildDetailedSpecsFromKeySpecs(
      { has_nfc: 'Unknown', has_5g: 'No' },
      'mobile'
    );

    expect(sections).toEqual([]);
  });
});
