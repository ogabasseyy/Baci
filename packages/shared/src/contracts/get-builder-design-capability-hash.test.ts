import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { getBuilderDesignCapabilityHash } from './get-builder-design-capability-hash';

describe('getBuilderDesignCapabilityHash', () => {
  it('returns the canonical lowercase SHA-256 digest without a prefix', () => {
    const hash = getBuilderDesignCapabilityHash({ b: 2, a: 1 });

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777'
    );
  });

  it('is stable for semantically identical capability data across calls', () => {
    const reordered = {
      components: builderDesignCapabilities.components,
      refusalCodes: builderDesignCapabilities.refusalCodes,
      themeTokenKeys: builderDesignCapabilities.themeTokenKeys,
      capabilityVersion: builderDesignCapabilities.capabilityVersion,
      version: builderDesignCapabilities.version,
    };

    expect(getBuilderDesignCapabilityHash(builderDesignCapabilities)).toBe(
      getBuilderDesignCapabilityHash(reordered)
    );
  });

  it('changes when a capability limit, token, or refusal rule changes', () => {
    const base = getBuilderDesignCapabilityHash(builderDesignCapabilities);
    const changedLimit = structuredClone(builderDesignCapabilities);
    changedLimit.components[0].props.title = {
      maximumLength: 121,
      type: 'string',
    };
    const changedToken = structuredClone(builderDesignCapabilities);
    changedToken.themeTokenKeys = [...changedToken.themeTokenKeys, 'surface'];
    const changedRefusal = structuredClone(builderDesignCapabilities);
    changedRefusal.refusalCodes['unsafe-code'] = 'Changed boundary';

    expect(getBuilderDesignCapabilityHash(changedLimit)).not.toBe(base);
    expect(getBuilderDesignCapabilityHash(changedToken)).not.toBe(base);
    expect(getBuilderDesignCapabilityHash(changedRefusal)).not.toBe(base);
  });

  it('distinguishes refusal text that differs only by an astral Unicode character', () => {
    expect(getBuilderDesignCapabilityHash({ refusal: 'Blocked 😀' })).not.toBe(
      getBuilderDesignCapabilityHash({ refusal: 'Blocked 😁' })
    );
  });

  it('excludes capabilityHash only at the root level', () => {
    expect(
      getBuilderDesignCapabilityHash({
        nested: { beta: 2, alpha: 1 },
        capabilityHash: 'stale',
      })
    ).toBe(getBuilderDesignCapabilityHash({ nested: { alpha: 1, beta: 2 } }));
    expect(
      getBuilderDesignCapabilityHash({ nested: { capabilityHash: 'first' } })
    ).not.toBe(
      getBuilderDesignCapabilityHash({ nested: { capabilityHash: 'second' } })
    );
  });

  it('orders Unicode keys by deterministic UTF-16 code units', () => {
    expect(getBuilderDesignCapabilityHash({ ä: 2, z: 1 })).toBe(
      '7832a5d6150a56da1a4f0c8fa00c26a7350389b0fc8696707cd2abbbd32be0c1'
    );
  });

  it.each([
    [
      { emoji: '😀' },
      '4525cb52c6a0122eacc150bacd11eb4a1d4615485ca8a5639c28d70f1c240193',
    ],
    [
      { x: 'a'.repeat(47) },
      '02ba17f0ecc41d4bf8ea87b4119cbf5723e3d82d9584b0c81613d61362eb260f',
    ],
    [
      { x: 'a'.repeat(48) },
      'a50ce99268758d8860c127a5218ddbfbdcefb1d8aca94fa1a5c87886729551a4',
    ],
    [
      { x: 'a'.repeat(55) },
      'e3bf771ac4144826ee5114dd6e3bdf8ad3578a60a82603effc01e794edebffba',
    ],
    [
      { x: 'a'.repeat(56) },
      'cbfe309710dfddfd92f968127a31ece329232735822976115285805f5d47391a',
    ],
  ])('matches an independently generated UTF-8 SHA-256 vector', (value, hash) => {
    expect(getBuilderDesignCapabilityHash(value)).toBe(hash);
  });

  it.each([
    [undefined],
    [[undefined]],
    [{ value: undefined }],
    [{ value: Number.NaN }],
    [{ value: Number.POSITIVE_INFINITY }],
    [{ value: 1n }],
    [{ value: () => undefined }],
    [{ value: Symbol('value') }],
    [new Date()],
  ])('rejects non-JSON-compatible capability input: %o', (value) => {
    expect(() => getBuilderDesignCapabilityHash(value)).toThrow(
      'Expected JSON-compatible capability data'
    );
  });

  it.each([
    (() => {
      const value: unknown[] & { extra?: string } = [];
      value.extra = 'ignored';
      return value;
    })(),
    (() => {
      const value = [] as unknown as unknown[] & Record<PropertyKey, unknown>;
      value[Symbol('ignored')] = 'ignored';
      return value;
    })(),
    (() => {
      const value = { visible: true };
      Object.defineProperty(value, 'hidden', { value: true });
      return value;
    })(),
    Object.defineProperty({}, 'computed', { get: () => 'must not read' }),
  ])('rejects lossy own properties before serialization: %o', (value) => {
    expect(() => getBuilderDesignCapabilityHash(value)).toThrow(
      'Expected JSON-compatible capability data'
    );
  });
});
