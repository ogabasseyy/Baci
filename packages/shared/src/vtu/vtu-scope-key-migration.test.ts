import { describe, expect, it } from 'vitest';
import { hashVtuScopeDescriptor } from './vtu-scope-hash';
import {
  isLegacyVtuScopeKey,
  normalizePersistedVtuScopeKey,
} from './vtu-scope-key-migration';

describe('normalizePersistedVtuScopeKey', () => {
  it('migrates legacy colon-bearing keys to their digest', () => {
    const legacy = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    expect(normalizePersistedVtuScopeKey(legacy)).toBe(
      hashVtuScopeDescriptor(legacy)
    );
  });

  it('migrates even empty-scope legacy keys (separators always emit)', () => {
    const legacy = '::{"phoneNumber":"08030000000"}';
    expect(normalizePersistedVtuScopeKey(legacy)).toBe(
      hashVtuScopeDescriptor(legacy)
    );
  });

  it('is idempotent: digests and bare keys pass through', () => {
    const digest = hashVtuScopeDescriptor('m:u:{"a":1}');
    expect(normalizePersistedVtuScopeKey(digest)).toBe(digest);
    expect(normalizePersistedVtuScopeKey('bare-fixture')).toBe('bare-fixture');
  });
});

describe('isLegacyVtuScopeKey', () => {
  it('flags exactly the keys the migration rewrites', () => {
    expect(isLegacyVtuScopeKey('m:u:{"a":1}')).toBe(true);
    expect(isLegacyVtuScopeKey('::{"a":1}')).toBe(true);
    expect(isLegacyVtuScopeKey(hashVtuScopeDescriptor('m:u:{"a":1}'))).toBe(
      false
    );
    expect(isLegacyVtuScopeKey('bare-fixture')).toBe(false);
  });
});
