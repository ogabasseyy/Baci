import { describe, expect, it, jest } from '@jest/globals';
import { isSameSignedInUser } from './is-same-signed-in-user';

let mockUserId: string | null = 'user-a';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockUserId ? { id: mockUserId } : null }),
  },
}));

describe('isSameSignedInUser', () => {
  it('is true for the account that is still signed in', () => {
    mockUserId = 'user-a';
    expect(isSameSignedInUser('user-a')).toBe(true);
  });

  it('is false after an account switch or sign-out, or without a user', () => {
    mockUserId = 'user-b';
    expect(isSameSignedInUser('user-a')).toBe(false);
    mockUserId = null;
    expect(isSameSignedInUser('user-a')).toBe(false);
    expect(isSameSignedInUser(undefined)).toBe(false);
  });
});
