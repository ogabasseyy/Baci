import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { confirmDiscardUnreadableFunding } from './confirm-discard-unreadable-funding';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OTHER = '11111111-1111-4111-8111-111111111111';
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';

const mockAsk = jest.fn<(...args: unknown[]) => Promise<boolean>>();
const mockNotify = jest.fn();
const mockDiscard = jest.fn<(...args: unknown[]) => Promise<boolean>>();
let mockSameUser = true;
jest.mock('./fund/ask-wallet-fund', () => ({
  askWalletFund: (...args: unknown[]) => mockAsk(...args),
}));
jest.mock('./fund/wallet-outcome-notifier', () => ({
  walletOutcomeNotifier: () => mockNotify,
}));
jest.mock('./discard-unreadable-primary-card-funding', () => ({
  discardUnreadablePrimaryCardFunding: (...args: unknown[]) =>
    mockDiscard(...args),
}));
jest.mock('./is-same-signed-in-user', () => ({
  isSameSignedInUser: () => mockSameUser,
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockSameUser = true;
  mockDiscard.mockResolvedValue(true);
});

// Other stores never save a PiggyVest card funding; if one ever asks, it
// keeps today's alert (the PiggyVest-off path).
describe('unreadable saved card funding with the server keeping PiggyVest off', () => {
  it("asks with today's alert at any other store", () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    confirmDiscardUnreadableFunding({ merchantId: OTHER, userId: USER });

    expect(alert).toHaveBeenCalledWith(
      'Earlier card payment unreadable',
      expect.any(String),
      expect.any(Array)
    );
    expect(mockAsk).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe('owner walk decision: no alerts on the PiggyVest fund screens', () => {
  it('asks in the sheet and, on Continue, clears the record and retries', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    mockAsk.mockResolvedValue(true);
    const onRetry = jest.fn();

    confirmDiscardUnreadableFunding({
      merchantId: PILOT,
      onRetry,
      userId: USER,
    });
    await settle();

    expect(alert).not.toHaveBeenCalled();
    expect(mockAsk).toHaveBeenCalledWith(
      'Earlier card payment unreadable',
      expect.any(String),
      'Continue anyway'
    );
    expect(mockDiscard).toHaveBeenCalledWith(PILOT, USER);
    expect(onRetry).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('does nothing when the customer declines', async () => {
    mockAsk.mockResolvedValue(false);
    const onRetry = jest.fn();

    confirmDiscardUnreadableFunding({
      merchantId: PILOT,
      onRetry,
      userId: USER,
    });
    await settle();

    expect(mockDiscard).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('shows a storage notice instead of retrying when the record stays', async () => {
    mockAsk.mockResolvedValue(true);
    mockDiscard.mockResolvedValue(false);
    const onRetry = jest.fn();

    confirmDiscardUnreadableFunding({
      merchantId: PILOT,
      onRetry,
      userId: USER,
    });
    await settle();

    expect(onRetry).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not update this device' }),
      expect.anything()
    );
  });

  it('stops when another account signed in while the question was open', async () => {
    mockAsk.mockResolvedValue(true);
    mockSameUser = false;

    confirmDiscardUnreadableFunding({ merchantId: PILOT, userId: USER });
    await settle();

    expect(mockDiscard).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Signed-in account changed' }),
      expect.anything()
    );
  });
});
