import { describe, expect, it } from 'vitest';
import { parseRecipientPageIds } from './scheduled-notification-rpc.ts';

describe('parseRecipientPageIds', () => {
  it('rejects a page containing a row without a merchant id', () => {
    expect(
      parseRecipientPageIds([{ merchant_id: 'merchant-1' }, {}])
    ).toBeNull();
  });

  it('returns every merchant id from a valid recipient page', () => {
    expect(
      parseRecipientPageIds([
        { merchant_id: 'merchant-1' },
        { merchant_id: 'merchant-2' },
      ])
    ).toEqual(['merchant-1', 'merchant-2']);
  });
});
