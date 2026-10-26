import { primarySetupMock } from '@/components/wallet/primary-setup.test-utils';

it('keeps the wallet action unit fixture deterministic and free of provisioning requests', async () => {
  const setup = primarySetupMock();
  expect(setup.account).toBeNull();
  expect(setup.state).toBe('not_started');
  expect(setup.justCreated).toBe(false);
  expect(setup.acknowledgeReady()).toBeUndefined();
  expect(setup.refresh()).toBeUndefined();
  await expect(
    setup.submit({
      merchantId: 'merchant-a',
      bvn: '00000000000',
      consent: true,
    })
  ).resolves.toBeUndefined();
});
