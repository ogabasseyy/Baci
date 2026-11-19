import { describe, expect, it } from 'vitest';
import { jumiaProductExportSelectionCreateResponseSchema } from './product-export-selection-create-response';

const validResponse = {
  selectionId: '00000000-0000-4000-8000-000000000027',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

describe('jumiaProductExportSelectionCreateResponseSchema', () => {
  it('parses a response with a UUID and offset-aware expiry timestamp', () => {
    expect(
      jumiaProductExportSelectionCreateResponseSchema.parse(validResponse)
    ).toEqual(validResponse);
  });

  it.each([
    {},
    { selectionId: validResponse.selectionId },
    { expiresAt: validResponse.expiresAt },
    { selectionId: 'not-a-uuid', expiresAt: validResponse.expiresAt },
    { selectionId: validResponse.selectionId, expiresAt: 'not-a-timestamp' },
    { selectionId: 27, expiresAt: validResponse.expiresAt },
  ])('rejects an invalid or incomplete creation response', (response) => {
    expect(
      jumiaProductExportSelectionCreateResponseSchema.safeParse(response)
        .success
    ).toBe(false);
  });
});
