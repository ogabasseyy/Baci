import { describe, expect, it } from 'vitest';
import { hashVtuScopeDescriptor, isVtuScopeHash } from './vtu-scope-hash';

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

describe('isVtuScopeHash', () => {
  it('recognizes digests and rejects raw shaped keys', () => {
    const digest = hashVtuScopeDescriptor('m:u:{"a":1}');
    expect(isVtuScopeHash(digest)).toBe(true);
    expect(isVtuScopeHash('m:u:{"a":1}')).toBe(false);
    expect(isVtuScopeHash('0'.repeat(63))).toBe(false);
    expect(isVtuScopeHash('g'.repeat(64))).toBe(false);
  });
});
