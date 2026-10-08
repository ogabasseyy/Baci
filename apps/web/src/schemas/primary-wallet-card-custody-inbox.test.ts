import { describe, expect, it } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-custody-inbox.test-fixture';
import { primaryCardCustodyInboxSchemas as schemas } from './primary-wallet-card-custody-inbox';

describe('signed inbox durable capability schemas', () => {
  it('accepts bounded signed bytes and immutable claims under explicit mapping contracts', () => {
    expect(schemas.runtime.parse(fixture.configuration)).toEqual(
      fixture.configuration
    );
    expect(schemas.claims.parse([fixture.claim])).toEqual([fixture.claim]);
  });
  it.each([
    { rawHex: 'a' },
    { signature: 'unknown' },
    { attempts: 51 },
    { attempts: 0 },
    { rawHex: 'aa'.repeat(65537) },
    { token: 'not-a-uuid' },
  ])('rejects malformed persisted claims %#', (change) => {
    expect(
      schemas.claims.safeParse([{ ...fixture.claim, ...change }]).success
    ).toBe(false);
  });
  it('rejects unsupported payload assumptions and false storage acknowledgement', () => {
    expect(
      schemas.runtime.safeParse({
        ...fixture.configuration,
        signedInbox: {
          ...fixture.configuration.signedInbox,
          mappingContract: 'amount-matching',
        },
      }).success
    ).toBe(false);
    expect(schemas.acknowledgement.safeParse(false).success).toBe(false);
  });
});
