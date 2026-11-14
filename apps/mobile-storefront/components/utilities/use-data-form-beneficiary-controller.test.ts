import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { Biller } from '@/hooks/use-vtu-billers';
import { useDataFormBeneficiaryController } from './use-data-form-beneficiary-controller';

const mockDataPlans: Biller[] = [
  {
    billerId: 'mtn-1gb',
    billerName: 'MTN 1GB Data',
    billerType: 'Internet Data',
    categoryId: 'data',
    categoryName: 'Internet Data',
    billItems: [
      {
        amount: 1000,
        isAmountFixed: true,
        itemCode: 'MTN-1GB-MONTHLY',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'MTN 1GB Monthly',
      },
    ],
  },
];

const mockRecentRecipient = {
  id: 'data-1',
  title: 'MTN',
  identifierLabel: 'Phone Number',
  identifier: '08031234567',
  meta: '₦1,000',
  defaults: {
    amount: '1000',
    dataPlanCode: 'mtn-1gb',
    isVerified: true,
    networkProvider: 'mtn',
    phoneNumber: '08031234567',
  },
};

describe('useDataFormBeneficiaryController', () => {
  it('initializes with default values', () => {
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        initialPhoneNumber: '08031234567',
        parsedInitialAmount: 1000,
        dataPlans: mockDataPlans,
      })
    );

    expect(result.current.phoneNumber).toBe('08031234567');
    expect(result.current.selectedProvider).toBe('mtn');
    expect(result.current.isBeneficiarySelected).toBe(false);
    expect(result.current.planAmount).toBe(1000);
  });

  it('updates phone number and detects provider', () => {
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        parsedInitialAmount: 0,
        dataPlans: mockDataPlans,
      })
    );

    act(() => {
      result.current.handlePhoneChange('08031234567');
    });

    expect(result.current.phoneNumber).toBe('08031234567');
    expect(result.current.selectedProvider).toBe('mtn');
    expect(result.current.selectedDataBiller?.billerId).toBe('mtn-1gb');
  });

  it('selects recent recipient and syncs provider details', () => {
    const onSelectRecentRecipient = jest.fn();
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        parsedInitialAmount: 0,
        dataPlans: mockDataPlans,
        recentRecipients: [mockRecentRecipient],
        onSelectRecentRecipient,
      })
    );

    act(() => {
      result.current.handleSelectRecentRecipient(mockRecentRecipient);
    });

    expect(result.current.phoneNumber).toBe('08031234567');
    expect(result.current.selectedProvider).toBe('mtn');
    expect(result.current.isBeneficiarySelected).toBe(true);
    expect(onSelectRecentRecipient).toHaveBeenCalledWith(mockRecentRecipient);
  });

  it('derives a prefilled wallet return-to href for the current data purchase', () => {
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        initialPhoneNumber: '08031234567',
        initialPlan: 'MTN-1GB-MONTHLY',
        parsedInitialAmount: 1000,
        dataPlans: mockDataPlans,
      })
    );

    expect(result.current.walletReturnToHref).toBe(
      '/utilities/data?repeatAmount=1000&repeatPhoneNumber=08031234567&repeatNetworkProvider=mtn&repeatDataPlanCode=MTN-1GB-MONTHLY'
    );
  });

  it('omits empty fields from the wallet return-to href on an untouched form', () => {
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        parsedInitialAmount: 0,
        dataPlans: mockDataPlans,
      })
    );

    expect(result.current.walletReturnToHref).toBe('/utilities/data');
  });
});

describe('bugfix: fast input pushed the phone field past 11 digits (Fable walk 14)', () => {
  it('holds 11 digits and tells the customer when a burst lost some', () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        parsedInitialAmount: 0,
        dataPlans: mockDataPlans,
      })
    );
    act(() => result.current.handlePhoneChange('0803123'));
    act(() => result.current.handlePhoneChange('0803123456789'));
    expect(result.current.phoneNumber).toBe('08031234567');
    expect(alert).toHaveBeenCalledWith(
      'Check the phone number',
      expect.stringContaining('first 11 digits')
    );
    alert.mockRestore();
  });
});

describe('bugfix: a +234 number set from a recipient or the route stayed in +234 form (Muse)', () => {
  it('reads a stored +234 recipient and a prefilled +234 number as local numbers', () => {
    const { result } = renderHook(() =>
      useDataFormBeneficiaryController({
        initialPhoneNumber: '+2348031234567',
        parsedInitialAmount: 1000,
        dataPlans: mockDataPlans,
      })
    );
    expect(result.current.phoneNumber).toBe('08031234567');
    expect(result.current.selectedProvider).toBe('mtn');

    act(() => {
      result.current.handleSelectRecentRecipient({
        ...mockRecentRecipient,
        defaults: {
          ...mockRecentRecipient.defaults,
          phoneNumber: '+2348051234567',
        },
      });
    });
    expect(result.current.phoneNumber).toBe('08051234567');
  });
});
