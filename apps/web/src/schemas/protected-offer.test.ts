import { piggyvestProtectedOfferSchemas as shared } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { protectedOfferSchemas } from './protected-offer';

describe('protectedOfferSchemas', () => {
  it('re-exports the shared protected-offer contracts unchanged', () => {
    expect(protectedOfferSchemas).toEqual(shared);
    expect(Object.keys(protectedOfferSchemas).length).toBeGreaterThan(0);
  });
});
