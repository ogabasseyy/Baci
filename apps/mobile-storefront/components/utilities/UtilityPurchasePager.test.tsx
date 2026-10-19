import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import type PagerView from 'react-native-pager-view';
import type { UtilityRepeatRecipient } from '@/lib/utility-repeat';
import { UtilityPurchasePager } from './UtilityPurchasePager';

type MockBillFormProps = {
  isRepeatPaymentReady?: boolean;
  recentRecipients?: UtilityRepeatRecipient[];
  type: string;
};

const mockAirtimeForm = jest.fn<(props: Record<string, unknown>) => void>();
const mockBillForm = jest.fn<(props: MockBillFormProps) => void>();
const mockDataForm = jest.fn<(props: Record<string, unknown>) => void>();

jest.mock('@/components/utilities/AirtimeForm', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AirtimeForm: (props: Record<string, unknown>) => {
      mockAirtimeForm(props);
      return <Text>Airtime form</Text>;
    },
  };
});

jest.mock('@/components/utilities/BillForm', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BillForm: (props: MockBillFormProps) => {
      mockBillForm(props);
      return <Text>{`Bill form ${props.type}`}</Text>;
    },
  };
});

jest.mock('@/components/utilities/DataForm', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    DataForm: (props: Record<string, unknown>) => {
      mockDataForm(props);
      return <Text>Data form</Text>;
    },
  };
});

const visitedTypes = {
  airtime: true,
  data: true,
  gaming: true,
  power: true,
  tv: true,
};

function renderPager(overrides = {}) {
  const recipient: UtilityRepeatRecipient = {
    defaults: { phoneNumber: '08031234567' },
    id: 'recipient-1',
    identifier: '08031234567',
    identifierLabel: 'Phone Number',
    meta: 'MTN',
    title: 'Ada',
  };

  const props = {
    currentType: 'airtime' as const,
    initialPage: 0,
    onPageScroll: jest.fn(),
    onPageSelected: jest.fn(),
    onSuccess: jest.fn(),
    pagerRef: React.createRef<PagerView>(),
    quickRepeat: {
      handleRecipientSelect: jest.fn(),
      isRepeatPaymentReady: true,
      recentRecipients: [recipient],
      repeatDefaults: {
        amount: '5000',
        billerName: 'DSTV',
        billItemIdentifier: 'dstv-premium',
        customerIdentifier: '1234567890',
        customerName: 'Ada Lovelace',
        dataPlanCode: 'data-1gb',
        networkProvider: 'MTN',
        phoneNumber: '08031234567',
      },
      repeatRevision: 2,
    },
    visitedTypes,
    ...overrides,
  };

  return render(<UtilityPurchasePager {...props} />);
}

describe('UtilityPurchasePager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders visited utility forms inside the pager and forwards page events', () => {
    const onPageSelected = jest.fn();
    renderPager({
      onPageSelected,
      visitedTypes: { ...visitedTypes, data: false },
    });

    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(screen.queryByText('Data form')).not.toBeOnTheScreen();

    fireEvent(screen.getByTestId('pager-view'), 'onPageSelected', {
      nativeEvent: { position: 1 },
    });

    expect(onPageSelected).toHaveBeenCalledWith({
      nativeEvent: { position: 1 },
    });
  });

  it('passes repeat state only to the active utility type', () => {
    renderPager({ currentType: 'tv' });

    const tvProps = mockBillForm.mock.calls.find(
      ([props]) => props.type === 'tv'
    )?.[0];
    const powerProps = mockBillForm.mock.calls.find(
      ([props]) => props.type === 'power'
    )?.[0];

    expect(tvProps).toMatchObject({
      isRepeatPaymentReady: true,
      recentRecipients: expect.arrayContaining([
        expect.objectContaining({ id: 'recipient-1' }),
      ]),
    });
    expect(powerProps).toMatchObject({
      isRepeatPaymentReady: false,
      recentRecipients: [],
    });
  });

  it('stamps the submitted utility type onto each form success', () => {
    const onSuccess = jest.fn();
    renderPager({ onSuccess });

    // The pager stays swipeable in flight: without the stamp, a swipe
    // would repoint the result + history poll at the new selection.
    type SuccessFn = (result: { amount: number; reference: string }) => void;
    const airtimeOnSuccess = (
      mockAirtimeForm.mock.calls[0][0] as unknown as {
        onSuccess: SuccessFn;
      }
    ).onSuccess;
    const dataOnSuccess = (
      mockDataForm.mock.calls[0][0] as unknown as { onSuccess: SuccessFn }
    ).onSuccess;
    const billCallbacks = mockBillForm.mock.calls.map(
      ([props]) =>
        [
          (props as unknown as { type: string }).type,
          (props as unknown as { onSuccess: SuccessFn }).onSuccess,
        ] as const
    );

    airtimeOnSuccess({ amount: 100, reference: 'ref-air' });
    expect(onSuccess).toHaveBeenCalledWith({
      amount: 100,
      reference: 'ref-air',
      utilityType: 'airtime',
    });
    dataOnSuccess({ amount: 200, reference: 'ref-data' });
    expect(onSuccess).toHaveBeenCalledWith({
      amount: 200,
      reference: 'ref-data',
      utilityType: 'data',
    });
    for (const [type, callback] of billCallbacks) {
      callback({ amount: 300, reference: `ref-${type}` });
      expect(onSuccess).toHaveBeenCalledWith({
        amount: 300,
        reference: `ref-${type}`,
        utilityType: type,
      });
    }
  });
});
