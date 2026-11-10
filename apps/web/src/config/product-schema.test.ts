import { describe, expect, it } from 'vitest';
import { PRODUCT_SCHEMA_DESCRIPTION_MAX_LENGTH } from './product-schema';

describe('product schema configuration', () => {
  it('keeps schema descriptions within the shared metadata length cap', () => {
    expect(PRODUCT_SCHEMA_DESCRIPTION_MAX_LENGTH).toBe(500);
  });
});
