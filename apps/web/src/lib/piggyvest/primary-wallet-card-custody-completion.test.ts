import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { createPrimaryWalletCardCheckoutService } from './primary-wallet-card-checkout-service';

describe('durable custody completion to existing status API', () => {
  it('reads completed ledger status without collecting again or verifying reusable authorization', async () => {
    const scope = Object.fromEntries(
      Object.entries(fixture.intent).filter(
        ([key]) => key in schemas.scope.shape
      )
    );
    const execute = vi.fn().mockResolvedValue({
      ...fixture.intent,
      status: 'completed',
      authorizationUrl: 'https://checkout.paystack.com/old',
    });
    const provider = { initialize: vi.fn(), verify: vi.fn() };
    const service = createPrimaryWalletCardCheckoutService({
      settings: fixture.settings,
      scope,
      execute,
      provider,
      now: () => Date.parse('2026-10-07T20:00:00Z'),
    });
    expect(await service.status(fixture.intent.operationId)).toEqual({
      operationId: fixture.intent.operationId,
      reference: fixture.intent.reference,
      amountKobo: 25000,
      currency: 'NGN',
      status: 'completed',
    });
    expect(provider.verify).not.toHaveBeenCalled();
    expect(provider.initialize).not.toHaveBeenCalled();
  });
});
