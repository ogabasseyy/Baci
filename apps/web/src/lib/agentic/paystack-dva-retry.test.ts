import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const customer = {
  email: 'buyer@example.test',
  first_name: 'Buyer',
  last_name: 'Test',
  phone: '08011111111',
};
const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  json: vi.fn().mockResolvedValue(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.resetModules();
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_fixture');
});
afterEach(() => vi.unstubAllEnvs());
describe('DVA creation uncertainty', () => {
  it.each([
    'network',
    'timeout',
    'http400',
    'http500',
    'malformed',
  ] as const)('never starts a second bank request after %s', async (failure) => {
    const { createDedicatedVirtualAccount } = await import('./paystack');
    fetchMock.mockResolvedValueOnce(
      response(200, { status: true, data: { customer_code: 'CUS_fixture' } })
    );
    if (failure === 'network' || failure === 'timeout')
      fetchMock.mockRejectedValueOnce(new Error(failure));
    else if (failure === 'malformed')
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('invalid JSON')),
      });
    else
      fetchMock.mockResolvedValueOnce(
        response(failure === 'http400' ? 400 : 500, { message: 'unavailable' })
      );
    fetchMock.mockResolvedValueOnce(
      response(200, {
        status: true,
        data: { account_number: '0123456789', account_name: 'Fixture' },
      })
    );
    await expect(
      createDedicatedVirtualAccount(customer, {
        subaccount: 'ACCT_TESTMOCK1234567',
      })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).preferred_bank).toBe(
      'wema-bank'
    );
  });
  it('does not retry a provider response with status false', async () => {
    const { createDedicatedVirtualAccount } = await import('./paystack');
    fetchMock
      .mockResolvedValueOnce(
        response(200, { status: true, data: { customer_code: 'CUS_fixture' } })
      )
      .mockResolvedValueOnce(
        response(200, { status: false, message: 'unavailable' })
      );
    await expect(
      createDedicatedVirtualAccount(customer, {
        subaccount: 'ACCT_TESTMOCK1234567',
      })
    ).rejects.toThrow('Failed to assign DVA');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
