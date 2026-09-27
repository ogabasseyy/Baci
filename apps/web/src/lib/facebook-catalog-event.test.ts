import { describe, expect, it } from 'vitest';
import { facebookCatalogEvent } from './facebook-catalog-event';

describe('facebookCatalogEvent', () => {
  it('matches parent product IDs to catalog item groups', () => {
    expect(
      facebookCatalogEvent({ content_ids: ['phone'], value: 891000 })
    ).toEqual({
      content_ids: ['phone'],
      value: 891000,
      content_type: 'product_group',
    });
  });
  it('does not invent catalog fields for non-commerce events', () => {
    expect(facebookCatalogEvent({ value: 5 })).toEqual({ value: 5 });
  });
});
