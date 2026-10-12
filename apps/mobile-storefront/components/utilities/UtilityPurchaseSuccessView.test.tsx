import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { UtilityPurchaseSuccessView } from './UtilityPurchaseSuccessView';
import type { UtilityPurchaseResult } from './utility-purchase.types';

const mockStackScreen = jest.fn((_props: unknown) => null);
let mockLastBackfillInput: unknown = null;

jest.mock('expo-router', () => ({
  Stack: {
    Screen: (props: unknown) => mockStackScreen(props),
  },
}));

const mockBackfillResult = jest.fn<
  () => { pin: string | null; status: 'successful' | 'failed' | null }
>(() => ({ pin: null, status: null }));

jest.mock('@/hooks/use-vtu-voucher-pin-backfill', () => ({
  useVtuVoucherPinBackfill: (input: unknown) => {
    mockLastBackfillInput = input;
    return mockBackfillResult();
  },
}));

jest.mock('@/components/utilities/PurchaseSuccess', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    PurchaseSuccess: ({
      amount,
      cashback,
      customerIdentifier,
      isAuthenticated,
      onCreateAccount,
      status,
      txReference,
      type,
      voucherPin,
    }: {
      amount?: number;
      cashback: { amount: number; newBalance: number } | null;
      customerIdentifier?: string;
      isAuthenticated: boolean;
      onCreateAccount: () => void;
      status?: string;
      txReference: string;
      type: string;
      voucherPin?: string;
    }) => (
      <View>
        <Text>{`PurchaseSuccess ${type}`}</Text>
        <Text>{`Amount ${amount ?? 'none'}`}</Text>
        <Text>{`Customer ${customerIdentifier ?? 'none'}`}</Text>
        <Text>{`Reference ${txReference}`}</Text>
        <Text>{`Status ${status ?? 'successful'}`}</Text>
        <Text>{`Voucher ${voucherPin ?? 'none'}`}</Text>
        <Text>{`Cashback ${cashback?.amount ?? 'none'}`}</Text>
        <Text>{isAuthenticated ? 'Authenticated' : 'Guest'}</Text>
        <Pressable
          accessibilityLabel="Create account from purchase success"
          accessibilityRole="button"
          onPress={onCreateAccount}
        >
          <Text>Create Account</Text>
        </Pressable>
      </View>
    ),
  };
});

describe('UtilityPurchaseSuccessView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLastBackfillInput = null;
    mockBackfillResult.mockReturnValue({ pin: null, status: null });
  });

  it('hides the native header and passes purchase data to the success view', () => {
    const data: UtilityPurchaseResult = {
      amount: 1000,
      cashback: { amount: 50, newBalance: 1200 },
      customerIdentifier: '43901766923',
      reference: 'ref-123',
      status: 'processing',
      voucherPin: '1234-5678',
    };

    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={data}
        headerOffset={20}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        type="power"
      />
    );

    expect(screen.getByText('PurchaseSuccess power')).toBeOnTheScreen();
    expect(screen.getByText('Amount 1000')).toBeOnTheScreen();
    expect(screen.getByText('Customer 43901766923')).toBeOnTheScreen();
    expect(screen.getByText('Reference ref-123')).toBeOnTheScreen();
    expect(screen.getByText('Status processing')).toBeOnTheScreen();
    expect(screen.getByText('Voucher 1234-5678')).toBeOnTheScreen();
    expect(screen.getByText('Cashback 50')).toBeOnTheScreen();
    expect(screen.getByText('Authenticated')).toBeOnTheScreen();
    expect(mockStackScreen).toHaveBeenCalledWith({
      options: { headerShown: false },
    });
  });

  it('passes null cashback and wires account creation for guests', () => {
    const onCreateAccount = jest.fn();

    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 500,
          customerIdentifier: '08031234567',
          reference: 'ref-guest',
        }}
        headerOffset={20}
        isAuthenticated={false}
        onCreateAccount={onCreateAccount}
        type="airtime"
      />
    );

    expect(screen.getByText('Cashback none')).toBeOnTheScreen();
    expect(screen.getByText('Guest')).toBeOnTheScreen();

    fireEvent.press(
      screen.getByLabelText('Create account from purchase success')
    );

    expect(onCreateAccount).toHaveBeenCalledTimes(1);
  });

  it('falls back to a backfilled voucher pin when the route param is missing', () => {
    mockBackfillResult.mockReturnValue({ pin: '9999-0000', status: null });

    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 2000,
          customerIdentifier: '43901766923',
          reference: 'ref-power',
          status: 'successful',
        }}
        headerOffset={20}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        type="power"
      />
    );

    expect(screen.getByText('Voucher 9999-0000')).toBeOnTheScreen();
  });

  it('enables voucher backfill when a bill purchase is processing', () => {
    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 2000,
          customerIdentifier: '43901766923',
          reference: 'ref-processing',
          status: 'processing',
        }}
        headerOffset={20}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        type="power"
      />
    );

    expect(mockLastBackfillInput).toEqual({
      enabled: true,
      reference: 'ref-processing',
      utilityType: 'power',
    });
  });

  it('shows the backfilled terminal status instead of stale processing', () => {
    mockBackfillResult.mockReturnValue({ pin: null, status: 'successful' });

    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 500,
          customerIdentifier: '08031234567',
          reference: 'ref-telco',
          status: 'processing',
        }}
        headerOffset={20}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        type="airtime"
      />
    );

    expect(screen.getByText('Status successful')).toBeOnTheScreen();
  });

  it('notifies once when polling settles a processing purchase', () => {
    mockBackfillResult.mockReturnValue({ pin: null, status: 'failed' });
    const onBackfillSettled = jest.fn();

    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 500,
          customerIdentifier: '08031234567',
          reference: 'ref-telco-fail',
          status: 'processing',
        }}
        headerOffset={20}
        isAuthenticated={true}
        onBackfillSettled={onBackfillSettled}
        onCreateAccount={jest.fn()}
        type="airtime"
      />
    );

    expect(screen.getByText('Status failed')).toBeOnTheScreen();
    expect(onBackfillSettled).toHaveBeenCalledTimes(1);
    expect(onBackfillSettled).toHaveBeenCalledWith('failed');
  });

  it('does not notify when the backfill status matches the purchase', () => {
    mockBackfillResult.mockReturnValue({ pin: null, status: 'successful' });
    const onBackfillSettled = jest.fn();

    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 500,
          customerIdentifier: '08031234567',
          reference: 'ref-already',
          status: 'successful',
        }}
        headerOffset={20}
        isAuthenticated={true}
        onBackfillSettled={onBackfillSettled}
        onCreateAccount={jest.fn()}
        type="airtime"
      />
    );

    expect(onBackfillSettled).not.toHaveBeenCalled();
  });

  it('disables voucher backfill when the route already has a voucher pin', () => {
    render(
      <UtilityPurchaseSuccessView
        bottomPadding={32}
        colors={Colors.light}
        data={{
          amount: 2000,
          customerIdentifier: '43901766923',
          reference: 'ref-with-pin',
          status: 'processing',
          voucherPin: '1234-5678',
        }}
        headerOffset={20}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        type="power"
      />
    );

    expect(mockLastBackfillInput).toEqual({
      enabled: false,
      reference: 'ref-with-pin',
      utilityType: 'power',
    });
  });
});
