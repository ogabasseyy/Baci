// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {} as Record<string, unknown>,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: mockAuth }),
}));

import {
  deletePasskey,
  listPasskeys,
  PASSKEY_STATE_CHANGED_EVENT,
  registerPasskey,
} from './passkey-client';

describe('passkey-client', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockAuth)) {
      delete mockAuth[key];
    }
  });

  describe('listPasskeys', () => {
    it('returns the SDK result when list() is available', async () => {
      const passkeys = [{ id: 'p1', created_at: '2026-01-01' }];
      mockAuth.passkey = {
        list: vi.fn().mockResolvedValue({ data: passkeys, error: null }),
      };

      await expect(listPasskeys()).resolves.toEqual({
        data: passkeys,
        error: null,
      });
    });

    it('returns a not-enabled error when list() is missing', async () => {
      const result = await listPasskeys();
      expect(result.data).toBeNull();
      expect(result.error?.message).toMatch(/not enabled/i);
    });
  });

  describe('registerPasskey', () => {
    it('passes through the SDK result when registerPasskey() exists', async () => {
      mockAuth.registerPasskey = vi
        .fn()
        .mockResolvedValue({ data: { id: 'p2' }, error: null });

      await expect(registerPasskey()).resolves.toEqual({
        data: { id: 'p2' },
        error: null,
      });
    });

    it('notifies listeners after successful registration', async () => {
      const listener = vi.fn();
      window.addEventListener(PASSKEY_STATE_CHANGED_EVENT, listener);
      mockAuth.registerPasskey = vi
        .fn()
        .mockResolvedValue({ data: { id: 'p2' }, error: null });

      await registerPasskey();

      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener(PASSKEY_STATE_CHANGED_EVENT, listener);
    });

    it('returns a not-available error when registerPasskey() is missing', async () => {
      const result = await registerPasskey();
      expect(result.data).toBeNull();
      expect(result.error?.message).toMatch(/not available/i);
    });
  });

  describe('deletePasskey', () => {
    it('calls delete() with the passkey id when available', async () => {
      const del = vi.fn().mockResolvedValue({ data: null, error: null });
      mockAuth.passkey = { delete: del };

      await deletePasskey('p3');

      expect(del).toHaveBeenCalledWith({ passkeyId: 'p3' });
    });

    it('notifies listeners after successful deletion', async () => {
      const listener = vi.fn();
      window.addEventListener(PASSKEY_STATE_CHANGED_EVENT, listener);
      mockAuth.passkey = {
        delete: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      await deletePasskey('p3');

      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener(PASSKEY_STATE_CHANGED_EVENT, listener);
    });

    it('returns a not-available error when delete() is missing', async () => {
      const result = await deletePasskey('p3');
      expect(result.error?.message).toMatch(/not available/i);
    });
  });
});
