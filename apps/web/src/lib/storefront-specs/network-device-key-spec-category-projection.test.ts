import { describe, expect, it } from 'vitest';
import { getNetworkDeviceKeySpecCategoryProjection } from './network-device-key-spec-category-projection';

describe('getNetworkDeviceKeySpecCategoryProjection', () => {
  it('exposes cellular network fields without phone-only imaging specs', () => {
    const fields = getNetworkDeviceKeySpecCategoryProjection().flatMap(
      (category) => category.fields
    );

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'network_technology' }),
        expect.objectContaining({ key: 'has_5g' }),
        expect.objectContaining({ key: 'sim_type' }),
        expect.objectContaining({ key: 'wifi_bands' }),
      ])
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'main_camera_mp' }),
        expect.objectContaining({ key: 'ram_gb' }),
        expect.objectContaining({ key: 'fingerprint_type' }),
      ])
    );
  });
});
