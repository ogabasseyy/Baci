import { expect, it, vi } from 'vitest';
import { launchKlumpCheckout } from './bnpl-launch-klump';
import type { BnplLaunchOrderContext } from './bnpl-launch-context';

const loadSdk = vi.hoisted(() => vi.fn());
vi.mock('@/lib/klump-sdk', () => ({
  loadKlumpSdk: loadSdk,
  getKlumpConstructor: vi.fn(),
  getKlumpPublicKey: vi.fn(),
}));

it('rejects a bookmarked Klump launch before loading the provider', async () => {
  const context = {
    order: { id: 'historical-order', total: 50000, items: [] },
    klumpReference: 'BAC-EXISTING',
    trackingToken: 'existing-proof',
    setStatus: vi.fn(),
    setErrorMessage: vi.fn(),
  } as unknown as BnplLaunchOrderContext;

  await launchKlumpCheckout(context);

  expect(context.setStatus).toHaveBeenCalledWith('error');
  expect(context.setErrorMessage).toHaveBeenCalledWith(
    'Klump is no longer available. Please choose another payment method.'
  );
  expect(loadSdk).not.toHaveBeenCalled();
});
