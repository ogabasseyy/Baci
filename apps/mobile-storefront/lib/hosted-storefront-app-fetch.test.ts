import { createHostedStorefrontAppFetch } from './hosted-storefront-app-fetch';

jest.mock('./is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => mockPaymentsEnabled,
}));

let mockPaymentsEnabled = true;

describe('hosted saved-card contributions', () => {
  beforeEach(() => {
    mockPaymentsEnabled = true;
  });

  it('forwards a saved-card POST to the enabled staging origin', async () => {
    const transport = jest.fn(async () => new Response('{}'));
    await createHostedStorefrontAppFetch(transport)(
      'https://staging.ogabassey.com/api/storefront/customer/savings/card-contributions',
      { method: 'POST' }
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['https://staging.ogabassey.com', 'POST', false],
    ['https://ogabassey.com', 'POST', true],
    ['https://staging.ogabassey.com', 'PATCH', true],
  ])('rejects an unapproved mutation to %s with %s', async (origin, method, enabled) => {
    mockPaymentsEnabled = enabled as boolean;
    const transport = jest.fn(async () => new Response('{}'));
    await expect(
      createHostedStorefrontAppFetch(transport)(
        `${origin}/api/storefront/customer/savings/card-contributions`,
        { method: method as string }
      )
    ).rejects.toThrow('Hosted staging financial operations are disabled');
    expect(transport).not.toHaveBeenCalled();
  });
});
