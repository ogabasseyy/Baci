import { describe, expect, it } from 'vitest';

import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

describe('shouldIncludeProductSchemaSpec camera policies', () => {
  it('applies the camera key allowlist and rejects card-slot placeholders', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { key: 'network_technology', value: 'N/A' }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Network Technology', value: 'N/A' }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Selfie Camera', value: '0MP' }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { key: 'front_camera_mp', value: 0 }
      )
    ).toBe(false);

    for (const value of ['N/A', 'None', 'Not supported']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Cameras', categories: null },
          { key: 'card_slot_type', value }
        )
      ).toBe(false);
    }
  });

  it('retains verified cellular network technology for computers', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Laptops', categories: null },
        { key: 'network_technology', value: '5G NR' }
      )
    ).toBe(true);
  });

  it('retains cellular specifications for network connectivity devices', () => {
    for (const candidate of [
      { key: 'network_technology', value: '5G NR' },
      { key: 'sim_type', value: 'Nano-SIM' },
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Cellular Routers', categories: null },
          candidate
        )
      ).toBe(true);
    }

    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { key: 'network_technology', value: '5G NR' }
      )
    ).toBe(false);
  });

  it('retains dash cam front camera resolution in keyed specifications', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Dash Cams', categories: null },
        { key: 'front_camera_mp', value: 12 }
      )
    ).toBe(true);
  });
  it('retains generic wireless connectivity rows without inferring charging', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Wireless', value: 'Wi-Fi 802.11ac' }
      )
    ).toBe(true);
  });

  it('rejects phone and computer operating system labels on cameras', () => {
    for (const value of ['Android 14', 'iOS 17', 'Windows 11', 'macOS 14']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Cameras', categories: null },
          { label: 'Operating System', value }
        )
      ).toBe(false);
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Cameras', categories: null },
          { label: 'OS', value }
        )
      ).toBe(false);
    }
  });
});
