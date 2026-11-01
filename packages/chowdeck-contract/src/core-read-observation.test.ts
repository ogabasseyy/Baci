import {
  classifyObservationBytes,
  classifyObservationLatency,
  createBlockedCoreObservation,
  parseAccountIdentity,
  parseCoreObservation,
} from './core-read-observation';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('core read observation', () => {
  it('requires the exact runtime identity tuple without persisting it', () => {
    const identity = parseAccountIdentity({
      currency: 'NGN',
      domain: 'merchant.example.com',
      vendorId: 'vendor-123',
    });
    const observation = createBlockedCoreObservation({
      capturedAt: '2026-09-08T12:00:00.000Z',
      manifestDigest: DIGEST,
      publicContractDigest: DIGEST,
    });

    expect(identity).toEqual({
      currency: 'NGN',
      domain: 'merchant.example.com',
      vendorId: 'vendor-123',
    });
    expect(JSON.stringify(observation)).not.toContain('merchant.example.com');
    expect(JSON.stringify(observation)).not.toContain('vendor-123');
    expect(JSON.stringify(observation)).not.toContain('NGN');
  });

  it.each([
    [{ domain: 'merchant.example.com', vendorId: 'vendor-123' }],
    [
      {
        currency: 'ngn',
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
      },
    ],
    [
      {
        currency: 'NG',
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
      },
    ],
    [
      {
        currency: 'ZZZ',
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
      },
    ],
    [
      {
        currency: 'BGN',
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
      },
    ],
    [{ currency: 'NGN', domain: '', vendorId: 'vendor-123' }],
    [{ currency: 'NGN', domain: 'merchant.example.com', vendorId: '' }],
    [
      {
        currency: 'NGN',
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
        email: 'bait@example.com',
      },
    ],
  ])('rejects an incomplete, malformed, or extended runtime identity tuple', (input) => {
    expect(() => parseAccountIdentity(input)).toThrow(
      'Invalid account identity'
    );
  });

  it('maps raw aggregate measurements only to fixed coarse buckets', () => {
    expect(classifyObservationLatency(0)).toBe('under_250ms');
    expect(classifyObservationLatency(249)).toBe('under_250ms');
    expect(classifyObservationLatency(250)).toBe('250ms_to_1s');
    expect(classifyObservationLatency(999)).toBe('250ms_to_1s');
    expect(classifyObservationLatency(1_000)).toBe('1s_to_2s');
    expect(classifyObservationLatency(2_500)).toBe('2s_to_5s');
    expect(classifyObservationLatency(5_000)).toBe('5s_to_10s');
    expect(classifyObservationLatency(10_000)).toBe('5s_to_10s');
    expect(classifyObservationLatency(10_001)).toBe('over_10s');
    expect(classifyObservationBytes(0)).toBe('under_16kib');
    expect(classifyObservationBytes(16 * 1024 - 1)).toBe('under_16kib');
    expect(classifyObservationBytes(16 * 1024)).toBe('16kib_to_64kib');
    expect(classifyObservationBytes(1_048_576)).toBe('256kib_to_1mib');
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid latency %s', (value) => {
    expect(() => classifyObservationLatency(value)).toThrow(
      'Invalid observation measurement'
    );
  });
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid byte count %s', (value) => {
    expect(() => classifyObservationBytes(value)).toThrow(
      'Invalid observation measurement'
    );
  });

  it('creates a strict non-live receipt with every capability unproven', () => {
    const observation = createBlockedCoreObservation({
      capturedAt: '2026-09-08T12:00:00.000Z',
      manifestDigest: DIGEST,
      publicContractDigest: DIGEST,
    });

    expect(parseCoreObservation(observation)).toEqual(observation);
    expect(observation).toMatchObject({
      contractVersion: 1,
      status: 'not_observed',
      blockerCode: 'provider_response_schema_unproven',
      capabilities: {
        accountRead: 'unproven',
        categoryRead: 'unproven',
        itemRead: 'unproven',
        menuRead: 'unproven',
      },
    });
    expect(observation.latencyBucket).toBe('unavailable');
    expect(observation.byteBucket).toBe('unavailable');
  });

  it('rejects unknown fields and identity or request-level metrics in evidence', () => {
    const observation = createBlockedCoreObservation({
      capturedAt: '2026-09-08T12:00:00.000Z',
      manifestDigest: DIGEST,
      publicContractDigest: DIGEST,
    });

    expect(() =>
      parseCoreObservation({ ...observation, requestDurationMs: 17 })
    ).toThrow('Invalid core observation');
    expect(() =>
      parseCoreObservation({ ...observation, vendorId: 'vendor-123' })
    ).toThrow('Invalid core observation');
    expect(() =>
      parseCoreObservation({ ...observation, blockerCode: 'bait@example.com' })
    ).toThrow('Invalid core observation');
  });
});
