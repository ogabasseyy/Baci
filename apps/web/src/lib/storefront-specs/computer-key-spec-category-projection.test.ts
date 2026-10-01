import { describe, expect, it } from 'vitest';
import { getComputerKeySpecCategoryProjection } from './computer-key-spec-category-projection';

describe('getComputerKeySpecCategoryProjection', () => {
  it('keeps optional cellular and audio hardware while excluding stale camera fields', () => {
    const fieldKeys = getComputerKeySpecCategoryProjection()
      .flatMap((category) => category.fields)
      .map((field) => field.key);

    expect(fieldKeys).toEqual(
      expect.arrayContaining([
        'has_5g',
        'sim_type',
        'has_nfc',
        'has_headphone_jack',
        'has_stereo_speakers',
      ])
    );
    expect(fieldKeys).not.toEqual(
      expect.arrayContaining([
        'android_version',
        'main_camera_mp',
        'front_camera_mp',
      ])
    );
  });
});
