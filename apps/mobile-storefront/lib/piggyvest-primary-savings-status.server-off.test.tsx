import {
  SERVER_OFF_MERCHANT_ID,
  SERVER_OFF_OPERATION_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { checkPiggyvestPrimarySavingsStatus } from './piggyvest-primary-savings-status';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

const input = {
  merchantId: SERVER_OFF_MERCHANT_ID,
  operationId: SERVER_OFF_OPERATION_ID,
};

// The server keeping PiggyVest off refuses the status read: the refusal
// reaches the caller at once (no wait for the deadline) and nothing else is
// sent.
describe('status read with the server off', () => {
  afterEach(() => jest.useRealTimers());

  it('passes the refusal through as a status PATCH only', async () => {
    mockFetchJson.mockRejectedValue(serverOffError());
    await expect(checkPiggyvestPrimarySavingsStatus(input)).rejects.toThrow(
      'not ready'
    );
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', timeoutMs: 15_000 })
    );
  });

  it('still ends at the deadline when the server never answers', async () => {
    jest.useFakeTimers();
    mockFetchJson.mockImplementation(() => new Promise(() => undefined));
    const check = checkPiggyvestPrimarySavingsStatus(input);
    const outcome = expect(check).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(15_000);
    await outcome;
  });
});
