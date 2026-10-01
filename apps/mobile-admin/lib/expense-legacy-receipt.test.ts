import { describe, expect, it } from 'vitest';
import { legacyMediaPath } from './expense-legacy-receipt';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';

describe('legacyMediaPath', () => {
  it('extracts an HTTPS media object path in the expense namespace', () => {
    expect(
      legacyMediaPath(
        merchantId,
        `https://project.supabase.co/storage/v1/object/public/media/expenses/${merchantId}/receipt.jpg`
      )
    ).toBe(`expenses/${merchantId}/receipt.jpg`);
  });

  it('rejects foreign, malformed, and non-HTTPS URLs', () => {
    expect(
      legacyMediaPath(merchantId, 'http://example.com/receipt.jpg')
    ).toBeNull();
    expect(
      legacyMediaPath(
        merchantId,
        `https://project.supabase.co/storage/v1/object/public/media/${merchantId}/receipt.jpg`
      )
    ).toBeNull();
  });
});
