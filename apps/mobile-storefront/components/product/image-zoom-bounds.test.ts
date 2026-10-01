import { describe, expect, it } from '@jest/globals';
import { getImageZoomDecodeBounds } from './image-zoom-bounds';

describe('image zoom decode bounds', () => {
  it('requests enough source resolution for the supported four-times zoom', () => {
    expect(getImageZoomDecodeBounds({ height: 600, width: 360 })).toEqual({
      height: 2_400,
      width: 1_440,
    });
  });
});
