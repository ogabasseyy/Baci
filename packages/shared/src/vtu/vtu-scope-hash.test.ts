import { describe, expect, it } from 'vitest';
import {
  buildPendingVtuScopeTag,
  hashVtuScopeDescriptor,
  isLegacyVtuScopeKey,
  isVtuScopeHash,
  normalizePersistedVtuScopeKey,
} from './vtu-scope-hash';

describe('hashVtuScopeDescriptor', () => {
  it('matches the SHA-256 known-answer vector', () => {
    // Independent oracle: sha256('abc') per FIPS 180-4.
    expect(hashVtuScopeDescriptor('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('is deterministic and digest-shaped', () => {
    const scoped = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    const a = hashVtuScopeDescriptor(scoped);
    expect(hashVtuScopeDescriptor(scoped)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs per scope and per descriptor', () => {
    const base = hashVtuScopeDescriptor('m:u:{"a":1}');
    expect(hashVtuScopeDescriptor('m:u:{"a":2}')).not.toBe(base);
    expect(hashVtuScopeDescriptor('m:other:{"a":1}')).not.toBe(base);
    expect(hashVtuScopeDescriptor('other:u:{"a":1}')).not.toBe(base);
  });

  it('carries no plaintext identifier', () => {
    const digest = hashVtuScopeDescriptor(
      'merchant-1:user-1:{"phoneNumber":"08030000000"}'
    );
    expect(digest).not.toContain('08030000000');
    expect(digest).not.toContain('merchant-1');
  });
});

describe('isVtuScopeHash / normalizePersistedVtuScopeKey', () => {
  it('recognizes digests and rejects raw shaped keys', () => {
    const digest = hashVtuScopeDescriptor('m:u:{"a":1}');
    expect(isVtuScopeHash(digest)).toBe(true);
    expect(isVtuScopeHash('m:u:{"a":1}')).toBe(false);
    expect(isVtuScopeHash('0'.repeat(63))).toBe(false);
    expect(isVtuScopeHash('g'.repeat(64))).toBe(false);
  });

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

  it('flags exactly the keys the migration rewrites', () => {
    expect(isLegacyVtuScopeKey('m:u:{"a":1}')).toBe(true);
    expect(isLegacyVtuScopeKey('::{"a":1}')).toBe(true);
    expect(isLegacyVtuScopeKey(hashVtuScopeDescriptor('m:u:{"a":1}'))).toBe(
      false
    );
    expect(isLegacyVtuScopeKey('bare-fixture')).toBe(false);
  });

  it('tags owner+merchant deterministically, null-normalized', () => {
    // Codex R62 6rtokd: the settle filter recomputes this from the
    // active account, so equal scopes must tag equally and any
    // difference (or null-vs-value) must tag differently.
    const tag = buildPendingVtuScopeTag('owner-a', 'merchant-1');
    expect(tag).toBe(buildPendingVtuScopeTag('owner-a', 'merchant-1'));
    expect(tag).not.toBe(buildPendingVtuScopeTag('owner-b', 'merchant-1'));
    expect(tag).not.toBe(buildPendingVtuScopeTag('owner-a', 'merchant-2'));
    expect(buildPendingVtuScopeTag(null, undefined)).toBe(
      buildPendingVtuScopeTag(undefined, null)
    );
    expect(isVtuScopeHash(tag)).toBe(true);
  });
});
