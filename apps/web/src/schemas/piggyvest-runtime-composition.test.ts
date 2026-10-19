import { describe, expect, it } from 'vitest';
import { piggyvestRuntimeCompositionSchemas as schemas } from './piggyvest-runtime-composition';

const merchantId = '10000000-0000-4000-8000-000000000001';
const configuration = {
  mode: 'local_test',
  goalId: '30000000-0000-4000-8000-000000000301',
  context: {
    environment: 'staging',
    transport: 'local_test',
    merchantId,
    integrationId: '40000000-0000-4000-8000-000000000001',
    expectedBusinessId: 'synthetic-business',
    expectedProjectId: 'synthetic',
    actualProjectId: 'synthetic',
    allowlistedMerchantIds: [merchantId],
    allowlistedCustomerIds: ['20000000-0000-4000-8000-000000000001'],
  },
  termsDocument: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic only',
  },
};

describe('local HTTP runtime configuration', () => {
  it('projects a strict explicit context and rejects private extras or project mismatch', () => {
    expect(schemas.configuration.parse(configuration)).toEqual(configuration);
    for (const input of [
      null,
      { ...configuration, mode: 'production' },
      { ...configuration, private: 'sentinel' },
      {
        ...configuration,
        context: { ...configuration.context, actualProjectId: 'other' },
      },
    ])
      expect(schemas.configuration.safeParse(input).success).toBe(false);
  });

  it('uses the existing valid-Unicode and byte-bounded terms contract', () => {
    const parseText = (text: string) =>
      schemas.configuration.safeParse({
        ...configuration,
        termsDocument: { ...configuration.termsDocument, text },
      }).success;
    expect(parseText('a'.repeat(32768))).toBe(true);
    expect(parseText('a'.repeat(32769))).toBe(false);
    expect(parseText('😀'.repeat(8193))).toBe(false);
    expect(parseText('\uD800')).toBe(false);
  });
  it.each([
    'https://127.0.0.1:1234',
    'http://localhost:1234',
    'http://0.0.0.0:1234',
    'http://user@127.0.0.1:1234',
    'http://127.0.0.1:1234/path',
    'http://127.0.0.1:0',
  ])('rejects unsafe origin %s', (origin) => {
    expect(schemas.origin.safeParse(origin).success).toBe(false);
  });
  it('allows exact IPv4 loopback and bounded ports including ephemeral bind', () => {
    expect(schemas.origin.parse('http://127.0.0.1:1234')).toBe(
      'http://127.0.0.1:1234'
    );
    expect(schemas.port.parse(0)).toBe(0);
    expect(schemas.port.safeParse(65536).success).toBe(false);
    expect(schemas.port.safeParse(-1).success).toBe(false);
    expect(schemas.port.safeParse(80).success).toBe(false);
    expect(schemas.configuration.safeParse(undefined).success).toBe(false);
  });
});
