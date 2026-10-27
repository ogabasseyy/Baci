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

describe('hosted authenticated savings RPCs', () => {
  it('forwards the authenticated paid-interest history RPC', async () => {
    const transport = jest.fn(async () => new Response('{}'));
    await createHostedStorefrontAppFetch(transport)(
      'https://staging-auth.ogabassey.com/rest/v1/rpc/get_customer_savings_interest_history',
      { method: 'POST' }
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('forwards the authenticated paid-interest snapshot RPC', async () => {
    const transport = jest.fn(async () => new Response('{}'));
    await createHostedStorefrontAppFetch(transport)(
      'https://staging-auth.ogabassey.com/rest/v1/rpc/get_customer_savings_interest_snapshot',
      { method: 'POST' }
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('continues to reject unallowlisted authenticated RPCs', async () => {
    const transport = jest.fn(async () => new Response('{}'));
    await expect(
      createHostedStorefrontAppFetch(transport)(
        'https://staging-auth.ogabassey.com/rest/v1/rpc/get_private_interest_rows',
        { method: 'POST' }
      )
    ).rejects.toThrow('Hosted staging financial operations are disabled');
    expect(transport).not.toHaveBeenCalled();
  });
});
