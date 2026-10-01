import { describe, expect, it } from 'vitest';
import { getAccessoryKeySpecCategoryProjection } from './accessory-key-spec-category-projection';

describe('getAccessoryKeySpecCategoryProjection', () => {
  it('retains safe power and connectivity fields without mobile hardware sections', () => {
    const fields = getAccessoryKeySpecCategoryProjection().flatMap(
      (category) => category.fields
    );

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'charging_watt' }),
        expect.objectContaining({ key: 'battery_mah' }),
        expect.objectContaining({ key: 'wifi_bands' }),
      ])
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'sim_type' }),
        expect.objectContaining({ key: 'main_camera_mp' }),
        expect.objectContaining({ key: 'ram_gb' }),
      ])
    );
  });
});
