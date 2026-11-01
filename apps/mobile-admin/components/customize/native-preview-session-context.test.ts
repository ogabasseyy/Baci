import { getRandomBytesAsync } from 'expo-crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativePreviewSession,
  rotateNativePreviewSession,
  sessionIsCurrent,
} from './native-preview-session-context';

vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
const random = vi.mocked(getRandomBytesAsync);
const input = {
  identityKey: 'user:merchant',
  draftRevision: 1,
  config: {},
  merchant: { id: 'm', slug: 'm' },
  isIdentityCurrent: () => true,
};
beforeEach(() => {
  random.mockReset();
});

describe('native preview session', () => {
  it('rejects short randomness and repeated nonces', async () => {
    random.mockResolvedValueOnce(new Uint8Array(15));
    await expect(
      createNativePreviewSession(input.identityKey, 1, 2)
    ).rejects.toThrow('Invalid random session bytes');
    random.mockResolvedValue(new Uint8Array(16).fill(1));
    const previous = await createNativePreviewSession(input.identityKey, 1, 2);
    await expect(
      rotateNativePreviewSession(previous, () => true)
    ).rejects.toThrow('Repeated session nonce');
  });
  it('rotates only while the original session remains current', async () => {
    random
      .mockResolvedValueOnce(new Uint8Array(16).fill(1))
      .mockResolvedValueOnce(new Uint8Array(16).fill(2))
      .mockResolvedValueOnce(new Uint8Array(16).fill(3));
    const previous = await createNativePreviewSession(input.identityKey, 1, 2);
    const next = await rotateNativePreviewSession(previous, () => true);
    expect(next?.previousNonce).toBe(previous.nonce);
    expect(next?.nonce).not.toBe(previous.nonce);
    expect(await rotateNativePreviewSession(previous, () => false)).toBeNull();
    expect(sessionIsCurrent(previous, input, 2, previous.nonce)).toBe(true);
    expect(
      sessionIsCurrent(
        previous,
        { ...input, isIdentityCurrent: () => false },
        2,
        previous.nonce
      )
    ).toBe(false);
    expect(sessionIsCurrent(previous, input, 3, previous.nonce)).toBe(false);
    expect(
      sessionIsCurrent(
        previous,
        { ...input, identityKey: 'other' },
        2,
        previous.nonce
      )
    ).toBe(false);
  });
});
