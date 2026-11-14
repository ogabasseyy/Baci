import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
  SERVER_OFF_OPERATION_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { addSavingsContribution } from './customer-savings';
import { addPiggyvestPrimarySavingsContribution } from './piggyvest-primary-savings';
import { recoverPiggyvestPrimarySavings } from './piggyvest-primary-savings-recovery';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('./customer-savings', () => ({ addSavingsContribution: jest.fn() }));
jest.mock('./piggyvest-primary-savings-recovery', () => ({
  recoverPiggyvestPrimarySavings: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

const input = {
  amount: 20,
  goalId: SERVER_OFF_GOAL_ID,
  idempotencyKey: SERVER_OFF_OPERATION_ID,
  merchantId: SERVER_OFF_MERCHANT_ID,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(recoverPiggyvestPrimarySavings).mockResolvedValue(null as never);
  jest
    .mocked(addSavingsContribution)
    .mockResolvedValue({ legacy: true } as never);
});

// The server keeping PiggyVest off answers the contribution with a not-ready
// code: the same operation id goes to the legacy flow, as in production today.
describe('server keeps PiggyVest off', () => {
  it('routes the contribution to the legacy flow with the same key', async () => {
    mockFetchJson.mockRejectedValue(serverOffError());
    const rails: string[] = [];
    const result = await addPiggyvestPrimarySavingsContribution({
      ...input,
      onRail: (rail) => rails.push(rail),
    });
    expect(result).toEqual({ legacy: true });
    expect(rails).toEqual(['primary', 'legacy']);
    expect(addSavingsContribution).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: SERVER_OFF_OPERATION_ID })
    );
  });

  it('never reaches legacy for an id already bound to primary', async () => {
    mockFetchJson.mockRejectedValue(serverOffError());
    await expect(
      addPiggyvestPrimarySavingsContribution({
        ...input,
        allowLegacyFallback: false,
      })
    ).rejects.toThrow('We are checking your earlier contribution');
    expect(addSavingsContribution).not.toHaveBeenCalled();
  });

  it('does not treat an ambiguous failure as the server being off', async () => {
    mockFetchJson.mockRejectedValue(new Error('network'));
    await expect(addPiggyvestPrimarySavingsContribution(input)).rejects.toThrow(
      'network'
    );
    expect(addSavingsContribution).not.toHaveBeenCalled();
  });
});
