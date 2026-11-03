import { describe, expect, it, vi } from 'vitest';
import { restrictPushTokensToRecipients } from './expo-push-recipient-filter';

describe('restrictPushTokensToRecipients', () => {
  it('filters to the given user ids', () => {
    const query = { in: vi.fn().mockReturnThis() };
    restrictPushTokensToRecipients(query, ['u1', 'u2']);
    expect(query.in).toHaveBeenCalledWith('user_id', ['u1', 'u2']);
  });

  it('leaves the query untouched without a recipient list', () => {
    const query = { in: vi.fn().mockReturnThis() };
    expect(restrictPushTokensToRecipients(query)).toBe(query);
    expect(query.in).not.toHaveBeenCalled();
  });
});
