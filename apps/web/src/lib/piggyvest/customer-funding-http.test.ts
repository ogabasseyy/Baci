import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerFundingHttp } from './customer-funding-http';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';

vi.mock('server-only', () => ({}));

function request(query: string, method = 'GET') {
  return new NextRequest(`http://localhost/funding${query}`, { method });
}

describe('fixed funding HTTP projection', () => {
  it('authenticates before inspecting configuration or query', async () => {
    const fixture = createFundingScreenFixture();
    fixture.getUser.mockRejectedValue(new Error('private auth error'));
    const options = {
      ...fixture.options,
      get configuration(): unknown {
        throw new Error('configuration read before authentication');
      },
    };
    const response = await createPiggyvestCustomerFundingHttp(options).GET(
      request('?walletId=injected')
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Funding unavailable' });
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '?walletId=injected',
    '?goalId=bad',
    '?goalId=bad&goalId=bad',
  ])('rejects malformed selection %s before protected reads', async (query) => {
    const fixture = createFundingScreenFixture();
    const response = await createPiggyvestCustomerFundingHttp(
      fixture.options
    ).GET(request(query));
    expect(response.status).toBe(400);
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects a different goal without granting client-selected scope', async () => {
    const fixture = createFundingScreenFixture();
    const response = await createPiggyvestCustomerFundingHttp(
      fixture.options
    ).GET(request('?goalId=30000000-0000-4000-8000-000000000002'));
    expect(response.status).toBe(403);
    expect(fixture.from).not.toHaveBeenCalled();
  });

  it('exposes the concrete verified screen without internal/provider metadata', async () => {
    const fixture = createFundingScreenFixture();
    const response = await createPiggyvestCustomerFundingHttp(
      fixture.options
    ).GET(request(`?goalId=${fixture.identity.goalId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'ready',
      funding: {
        status: 'ready',
        accounts: [
          {
            accountNumber: '0001234567',
            accountName: 'Synthetic account',
            bankName: 'Synthetic bank',
          },
        ],
      },
      progress: { status: 'unavailable' },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /synthetic-business|synthetic-wallet|actorId|customerId|balance|apiSecret/
    );
  });

  it('does not publish accounts after post-provider actor changes', async () => {
    const fixture = createFundingScreenFixture();
    const original = fixture.fetchImplementation.getMockImplementation();
    fixture.fetchImplementation.mockImplementation(async (...args) => {
      const response = await original?.(...args);
      if (String(args[0]).endsWith('/accounts'))
        fixture.getUser.mockRejectedValue(new Error('session expired'));
      if (!response) throw new Error('Synthetic response missing');
      return response;
    });
    const response = await createPiggyvestCustomerFundingHttp(
      fixture.options
    ).GET(request(`?goalId=${fixture.identity.goalId}`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Funding unavailable' });
  });

  it('keeps missing funding configuration unavailable, not eligible', async () => {
    const fixture = createFundingScreenFixture();
    const response = await createPiggyvestCustomerFundingHttp({
      ...fixture.options,
      fundingConfiguration: undefined,
    }).GET(request(`?goalId=${fixture.identity.goalId}`));
    expect(await response.json()).toMatchObject({
      status: 'ready',
      funding: { status: 'unavailable' },
      eligibility: { status: 'unavailable' },
      progress: { status: 'unavailable' },
    });
    expect(fixture.fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects POST without calling persistence or provider', async () => {
    const fixture = createFundingScreenFixture();
    const response = await createPiggyvestCustomerFundingHttp(
      fixture.options
    ).GET(request(`?goalId=${fixture.identity.goalId}`, 'POST'));
    expect(response.status).toBe(405);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.fetchImplementation).not.toHaveBeenCalled();
  });
});
