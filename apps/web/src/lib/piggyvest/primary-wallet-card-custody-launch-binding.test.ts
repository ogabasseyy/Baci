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
};
function sealedBytes(expiresAt: string, crosswalkExpiresAt: string) {
  const candidate = Buffer.from(
    JSON.stringify({
      deliveryContract: 'approved-primary-card-crosswalk-file-v1',
      integrationId: fixture.context.integrationId,
      environment: 'staging',
      expiresAt,
      records: [
        {
          operationId: fixture.context.operationId,
          crosswalk: { ...fixture.crosswalk, expiresAt: crosswalkExpiresAt },
        },
      ],
    })
  );
  return {
    rawBytes: candidate,
    approval: {
      ...approval,
      sha256: createHash('sha256').update(candidate).digest('hex'),
      signature: createHmac('sha256', issuerKey)
        .update(candidate)
        .digest('hex'),
    },
  };
}
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
  it('resolves past the evidence windows so post-expiry runs still drain acknowledged receipts', async () => {
    // Every window is long past; only the hierarchy ordering and identity
    // pins still apply. Freshness gates new work at the intake/runtime
    // layer, never this drain-only binding.
    const past = sealedBytes('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
    await expect(
      createPrimaryCardCustodyLaunchBinding({
        ...input,
        ...past,
        configuration: {
          ...fixture.configuration,
          expiresAt: '2026-10-01T00:00:00Z',
        },
      })(fixture.context, fixture.single)
    ).resolves.toEqual({
      ...fixture.crosswalk,
      expiresAt: '2026-10-01T00:00:00Z',
    });
  });
  it('rejects evidence that outlives the configuration it was issued under', () => {
    const future = sealedBytes('2099-06-01T00:00:00Z', '2099-01-01T00:00:00Z');
    expect(() =>
      createPrimaryCardCustodyLaunchBinding({ ...input, ...future })
    ).toThrow('unavailable');
  });
  it('rejects a record that outlives its delivery file', async () => {
    const skewed = sealedBytes(
      fixture.configuration.expiresAt,
      '2099-06-01T00:00:00Z'
    );
    await expect(
      createPrimaryCardCustodyLaunchBinding({ ...input, ...skewed })(
        fixture.context,
        fixture.single
      )
    ).rejects.toThrow('scope');
  });
});
