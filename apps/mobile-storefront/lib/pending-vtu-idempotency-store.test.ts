import { hashVtuScopeDescriptor } from '@baci/shared';
import { jest } from '@jest/globals';
import { parsePendingVtuSnapshot } from './pending-vtu-idempotency-codec';
import {
  clearForgottenVtuScopes,
  forgottenVtuScopes,
  loadPendingVtuSnapshot,
  noteForgottenVtuScopes,
  persistPendingVtuEntries,
  savePendingVtuSnapshot,
} from './pending-vtu-idempotency-store';

const mockMmkvStore = new Map<string, string>();
let mockMmkvSetThrows = false;
let mockMmkvCreateThrows = false;

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    if (mockMmkvCreateThrows) {
      throw new Error('MMKV unavailable');
    }
    return {
      getString: (key: string) => mockMmkvStore.get(key) ?? null,
      set: (key: string, value: string) => {
        if (mockMmkvSetThrows) {
          throw new Error('MMKV full');
        }
        mockMmkvStore.set(key, value);
      },
      remove: (key: string) => {
        mockMmkvStore.delete(key);
      },
    };
  },
}));

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: 'k',
    reference: null,
    rememberedAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

describe('pending-vtu-idempotency-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMmkvStore.clear();
    mockMmkvSetThrows = false;
    clearForgottenVtuScopes();
  });

  it('persist wrapper clears tombstones after a durable write', () => {
    noteForgottenVtuScopes(['a'], Date.now());

    expect(persistPendingVtuEntries([])).toBe(true);
    expect(forgottenVtuScopes.size).toBe(0);
    expect(
      parsePendingVtuSnapshot(loadPendingVtuSnapshot()).forgotten
    ).toHaveLength(1);
  });

  it('persist wrapper retains tombstones when the write throws', () => {
    mockMmkvSetThrows = true;
    noteForgottenVtuScopes(['a'], Date.now());

    expect(persistPendingVtuEntries([])).toBe(false);
    expect(forgottenVtuScopes.size).toBe(1);
    expect(loadPendingVtuSnapshot()).toBeNull();
  });

  it('reports failure when no store exists so submit refuses memory-only keys', async () => {
    // Codex R97 P1: a null bucket used to no-op into `true`, so the
    // submit path sent a checkout whose key a restart would lose.
    // Fresh module (the bucket caches per module) with createMMKV
    // throwing: save AND the persist wrapper report false.
    mockMmkvCreateThrows = true;
    try {
      jest.resetModules();
      const fresh = await import('./pending-vtu-idempotency-store');
      expect(fresh.savePendingVtuSnapshot('{"entries":[]}')).toBe(false);
      expect(fresh.persistPendingVtuEntries([])).toBe(false);
      expect(fresh.loadPendingVtuSnapshot()).toBeNull();
    } finally {
      mockMmkvCreateThrows = false;
      jest.resetModules();
    }
  });

  it('rewrites a legacy snapshot with digests on registry load', async () => {
    // Migrate-on-read must reach the disk: without a write-back an
    // abandoned entry keeps its plaintext identifiers at rest for
    // the full TTL (Codex R54 6rrFRH).
    const legacyEntry = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    const legacyTombstone = 'merchant-1:user-1:{"phoneNumber":"08030000002"}';
    const rememberedAt = Date.now();
    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [[legacyEntry, entry({ rememberedAt })]],
        forgotten: [{ scoped: legacyTombstone, forgottenAt: rememberedAt }],
      })
    );

    jest.resetModules();
    await import('./pending-vtu-idempotency');

    const stored = loadPendingVtuSnapshot() ?? '';
    expect(stored).not.toContain('08030000000');
    expect(stored).not.toContain('merchant-1:user-1');
    const parsed = parsePendingVtuSnapshot(stored);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0][0]).toBe(hashVtuScopeDescriptor(legacyEntry));
    expect(parsed.entries[0][1].key).toBe('k');
    expect(parsed.forgotten).toHaveLength(1);
    expect(parsed.forgotten[0].scoped).toBe(
      hashVtuScopeDescriptor(legacyTombstone)
    );
  });

  it('leaves a digest snapshot untouched on registry load', async () => {
    // No legacy keys: no write. The TTL-expired entry proves it —
    // any persist would have pruned it, changing the bytes.
    const digest = hashVtuScopeDescriptor('m:u:{"a":1}');
    const staleDigest = hashVtuScopeDescriptor('m:u:{"stale":true}');
    const original = JSON.stringify({
      entries: [
        [digest, entry({ rememberedAt: Date.now() })],
        [staleDigest, entry({ rememberedAt: 1 })],
      ],
      forgotten: [],
    });
    savePendingVtuSnapshot(original);

    jest.resetModules();
    await import('./pending-vtu-idempotency');

    expect(loadPendingVtuSnapshot()).toBe(original);
  });
});
