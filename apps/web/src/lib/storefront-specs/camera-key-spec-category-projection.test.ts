import { describe, expect, it } from 'vitest';
import { getCameraKeySpecCategoryProjection } from './camera-key-spec-category-projection';

describe('getCameraKeySpecCategoryProjection', () => {
  it('exposes verified camera capabilities without mobile network fields', () => {
    const fields = getCameraKeySpecCategoryProjection().flatMap(
      (category) => category.fields
    );

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'main_camera_mp' }),
        expect.objectContaining({ key: 'has_ois' }),
        expect.objectContaining({ key: 'has_nfc' }),
        expect.objectContaining({ key: 'positioning' }),
        expect.objectContaining({ key: 'card_slot_type' }),
      ])
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'has_5g' }),
        expect.objectContaining({ key: 'sim_type' }),
        expect.objectContaining({ key: 'front_camera_mp' }),
      ])
    );
  });

  it('projects dash-cam front cameras without exposing selfie fields elsewhere', () => {
    const dashCamFields = getCameraKeySpecCategoryProjection(
      'Dash Cams'
    ).flatMap((category) => category.fields);
    const actionCameraFields = getCameraKeySpecCategoryProjection(
      'Action Cameras'
    ).flatMap((category) => category.fields);

    expect(dashCamFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'front_camera_mp',
          label: 'Front Camera',
        }),
      ])
    );
    expect(actionCameraFields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'front_camera_mp' }),
      ])
    );
  });
});
