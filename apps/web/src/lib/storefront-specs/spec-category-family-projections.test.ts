import { describe, expect, it } from 'vitest';
import { getKeySpecCategoryProjection } from './spec-category-family-projections';

describe('getKeySpecCategoryProjection', () => {
  it('dispatches each supported family to its focused projection', () => {
    expect(
      getKeySpecCategoryProjection('camera').flatMap(
        (category) => category.fields
      )
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'has_ois' })])
    );
    expect(
      getKeySpecCategoryProjection('computer').flatMap(
        (category) => category.fields
      )
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'has_5g' })])
    );
    expect(
      getKeySpecCategoryProjection('general-supported').flatMap(
        (category) => category.fields
      )
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'chipset' })])
    );
  });
});
