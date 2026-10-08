import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { createPrimaryCardCustodyLaunchBinding } from './primary-wallet-card-custody-launch-binding';

const bytes = Buffer.from(
  JSON.stringify({
    deliveryContract: 'approved-primary-card-crosswalk-file-v1',
    integrationId: fixture.context.integrationId,
    environment: 'staging',
    expiresAt: fixture.configuration.expiresAt,
    records: [
      {
        operationId: fixture.context.operationId,
        crosswalk: fixture.crosswalk,
      },
    ],
  })
);
const issuerKey = 'mock-issuer-delivery-key-0000000000';
const approval = {
  approved: 'true',
  path: '/fixture/crosswalk.json',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  signature: createHmac('sha256', issuerKey).update(bytes).digest('hex'),
  issuerKey,
};
const input = {
  rawBytes: bytes,
  approval,
  configuration: fixture.configuration,
  now: () => fixture.now,
};
describe('approved internal crosswalk delivery (not a PiggyVest signing contract)', () => {
  it('does not authorize a new payment from reusable wallet ownership alone', async () => {
    const operationId = '10000000-0000-4000-8000-000000000099';
    const reference = `pvb-primary-transfer-${operationId}`;
    const resolve = createPrimaryCardCustodyLaunchBinding(input);
    expect(
      await resolve(
        { ...fixture.context, operationId, reference },
        {
          ...fixture.single,
          data: { ...fixture.single.data, third_party_reference: reference },
        }
      )
    ).toBeNull();
  });
  it('binds authenticated delivery to exact operation and API transaction', async () => {
    expect(
      await createPrimaryCardCustodyLaunchBinding(input)(
        fixture.context,
        fixture.single
      )
    ).toEqual(fixture.crosswalk);
  });
  it('does not substitute equal amounts or a different canonical transaction', async () => {
    await expect(
      createPrimaryCardCustodyLaunchBinding(input)(fixture.context, {
        ...fixture.single,
        data: { ...fixture.single.data, id: 'different' },
      })
    ).rejects.toThrow('scope');
  });
  it.each([
    'sha256',
    'signature',
  ] as const)('rejects changed %s before provider or database access', (field) => {
    expect(() =>
      createPrimaryCardCustodyLaunchBinding({
        ...input,
        approval: { ...approval, [field]: '0'.repeat(64) },
      })
    ).toThrow();
  });
  it('rechecks expiry after initial construction', async () => {
    let now = fixture.now;
    const resolve = createPrimaryCardCustodyLaunchBinding({
      ...input,
      now: () => now,
    });
    now = Date.parse(fixture.configuration.expiresAt);
    await expect(resolve(fixture.context, fixture.single)).rejects.toThrow(
      'unavailable'
    );
  });
});
