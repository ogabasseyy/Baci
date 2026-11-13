import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { UtilityBeneficiary } from '@/lib/utility-beneficiaries';
import type { BillFormProps } from './bill-form.types';

type VerifySuccessData = {
  verified: boolean;
  customerName?: string;
  message: string;
};
type VerifyMutateOptions = {
  onSuccess?: (data: VerifySuccessData) => void;
};

// The controller reacts to verification via the mutation's per-call
// onSuccess callback, so the mock captures it for tests to invoke.
let lastVerifyMutateOptions: VerifyMutateOptions | undefined;
const mockVerifyMutate = jest.fn(
  (_variables: unknown, options?: VerifyMutateOptions) => {
    lastVerifyMutateOptions = options;
  }
);
const mockVerifyReset = jest.fn();

let mockVerifyData:
  | { verified: boolean; customerName?: string | null }
  | undefined;
let mockVerifyIsPending = false;

jest.mock('@/hooks/use-vtu-verify', () => ({
  useVTUVerify: () => ({
    data: mockVerifyData,
    error: null,
    isPending: mockVerifyIsPending,
    mutate: mockVerifyMutate,
    reset: mockVerifyReset,
  }),
}));

const MOCK_BILLER = {
  billerId: 'ekedc',
  billerName: 'EKEDC NG',
  billerType: 'Electricity',
  categoryId: 'electricity',
  billItems: [],
};

jest.mock('@/hooks/use-vtu-billers', () => ({
  useVTUBillers: () => ({ data: [MOCK_BILLER], isLoading: false }),
}));

jest.mock('@/hooks/use-utility-payment', () => ({
  useUtilityPayment: () => ({
    cards: [],
    isLoadingCards: false,
    refetchCards: jest.fn(),
    selectGateway: jest.fn(),
    selectSavedCard: jest.fn(),
    selectedGateway: 'paystack',
    selectedSavedCardId: null,
    supportedGateways: ['paystack'],
  }),
}));

// Mutable auth state so tests can simulate logout/login between renders.
let mockAuthCustomer: { id: string } | null = null;
jest.mock('@/stores/auth-store', () => {
  const useAuthStore = Object.assign(
    jest.fn(
      (selector: (state: { customer: { id: string } | null }) => unknown) =>
        selector({ customer: mockAuthCustomer })
    ),
    // The wallet pay hand-over reads the signed-in account directly.
    { getState: () => ({ user: null }) }
  );
  return { useAuthStore };
});

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    dismissKeyboard: jest.fn(),
    isKeyboardVisible: false,
    keyboardHeight: 0,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('./use-next-step-scroll', () => ({
  useNextStepScroll: () => jest.fn(),
}));

jest.mock('./create-bill-form-purchase-handler', () => ({
  createBillFormPurchaseHandler: () => jest.fn(),
}));

// --- Beneficiary mocks ---
const mockGetBeneficiaries =
  jest.fn<(authId: unknown) => Promise<UtilityBeneficiary[]>>();
const mockSaveBeneficiary =
  jest.fn<(authId: unknown, input: unknown) => Promise<void>>();
const mockFilterBeneficiaries =
  jest.fn<
    (
      beneficiaries: UtilityBeneficiary[],
      billerId: string,
      billItemIdentifier: string
    ) => UtilityBeneficiary[]
  >();

jest.mock('@/lib/utility-beneficiaries', () => ({
  getBeneficiaries: (...args: unknown[]) =>
    mockGetBeneficiaries(...(args as [unknown])),
  saveBeneficiary: (...args: unknown[]) =>
    mockSaveBeneficiary(...(args as [unknown, unknown])),
  filterBeneficiaries: (...args: unknown[]) =>
    mockFilterBeneficiaries(
      ...(args as [UtilityBeneficiary[], string, string])
    ),
}));

const MOCK_BENEFICIARY: UtilityBeneficiary = {
  id: 'ekedc:ekedc:43901766923',
  customerId: '43901766923',
  customerName: 'OLUROTIMI ADEBANJO',
  billerId: 'ekedc',
  billerName: 'EKEDC NG',
  billItemIdentifier: 'ekedc',
  lastUsed: 1000,
};

function makeProps(overrides: Partial<BillFormProps> = {}): BillFormProps {
  return {
    type: 'power',
    onSuccess: jest.fn(),
    ...overrides,
  };
}

async function importController() {
  const { useBillFormController } = await import('./use-bill-form-controller');
  return useBillFormController;
}

function triggerVerifySuccess(data: VerifySuccessData) {
  act(() => {
    lastVerifyMutateOptions?.onSuccess?.(data);
  });
}

describe('useBillFormController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastVerifyMutateOptions = undefined;
    mockVerifyData = undefined;
    mockVerifyIsPending = false;
    mockAuthCustomer = null;
    // Default stubs: keep background beneficiary loads pending so tests that
    // do not assert beneficiary state do not receive post-assertion updates.
    mockGetBeneficiaries.mockImplementation(
      () => new Promise<UtilityBeneficiary[]>(() => {})
    );
    mockSaveBeneficiary.mockResolvedValue(undefined);
    mockFilterBeneficiaries.mockReturnValue([]);
  });

  it('derives a prefilled wallet return-to href from the verified bill selection', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({
          initialAmount: '5000',
          initialBillerName: 'EKEDC NG',
          initialCustomerIdentifier: '43901766923',
          initialCustomerName: 'OLUROTIMI ADEBANJO',
        })
      )
    );

    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });
    act(() => {
      result.current.updateCustomerId('43901766923');
    });
    act(() => {
      result.current.updateAmount('5000');
    });

    // Before verification the href prefills what is known, and never claims a
    // verified meter.
    expect(result.current.walletReturnToHref).toContain('/utilities/power?');
    expect(result.current.walletReturnToHref).toContain('repeatAmount=5000');
    expect(result.current.walletReturnToHref).toContain(
      'repeatCustomerIdentifier=43901766923'
    );
    expect(result.current.walletReturnToHref).toContain(
      'repeatBillerName=EKEDC%20NG'
    );
    expect(result.current.walletReturnToHref).not.toContain('repeatVerified');

    act(() => {
      result.current.handleVerify();
    });
    triggerVerifySuccess({
      customerName: 'OLUROTIMI ADEBANJO',
      message: 'ok',
      verified: true,
    });

    // Once the meter is verified the round-trip can restore the verified state.
    expect(result.current.walletReturnToHref).toContain(
      'repeatCustomerName=OLUROTIMI%20ADEBANJO'
    );
    expect(result.current.walletReturnToHref).toContain('repeatVerified=1');
  });

  it('initializes verifiedCustomerName from initialCustomerName', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({ initialCustomerName: 'JANE METER-OWNER' })
      )
    );

    expect(result.current.verifiedCustomerName).toBe('JANE METER-OWNER');
  });

  it('verifiedCustomerName is null when no initialCustomerName is given', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() => useBillFormController(makeProps()));

    expect(result.current.verifiedCustomerName).toBeNull();
  });

  it('sets verifiedCustomerName from live verify response when customerName is provided', async () => {
    const useBillFormController = await importController();

    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({
          initialBillerName: 'EKEDC NG',
          initialCustomerIdentifier: '43901766923',
        })
      )
    );

    // Select a biller and enter a customer ID so handleVerify can proceed
    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });
    act(() => {
      result.current.updateCustomerId('43901766923');
    });
    act(() => {
      result.current.handleVerify();
    });

    // Simulate the verify mutation resolving successfully with a name
    triggerVerifySuccess({
      customerName: 'LIVE METER OWNER',
      message: 'ok',
      verified: true,
    });

    expect(result.current.verifiedCustomerName).toBe('LIVE METER OWNER');
  });

  it('clears verifiedCustomerName when live verify returns verified=true but no customerName', async () => {
    const useBillFormController = await importController();

    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({
          initialBillerName: 'EKEDC NG',
          initialCustomerIdentifier: '43901766923',
          initialCustomerName: 'OLD NAME',
        })
      )
    );

    expect(result.current.verifiedCustomerName).toBe('OLD NAME');

    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });
    act(() => {
      result.current.updateCustomerId('43901766923');
    });
    act(() => {
      result.current.handleVerify();
    });

    // Verify succeeds but returns no name — stale name should be cleared
    triggerVerifySuccess({ customerName: '', message: 'ok', verified: true });

    expect(result.current.verifiedCustomerName).toBeNull();
  });

  it('deactivateRepeatPayment clears both isRepeatPaymentActive and verifiedCustomerName', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({
          initialCustomerName: 'SOME OWNER',
          isRepeatPaymentReady: true,
        })
      )
    );

    act(() => {
      result.current.setRepeatPaymentActive(false);
    });

    expect(result.current.isRepeatPaymentActive).toBe(false);
    expect(result.current.verifiedCustomerName).toBeNull();
  });

  // ---- Beneficiary logic tests ----

  it('calls getBeneficiaries on mount to load stored beneficiaries', async () => {
    const useBillFormController = await importController();
    renderHook(() => useBillFormController(makeProps()));

    expect(mockGetBeneficiaries).toHaveBeenCalled();
  });

  it('returns empty beneficiaries when no biller is selected', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() => useBillFormController(makeProps()));

    // filterBeneficiaries should not be called because selectedBiller is null
    expect(result.current.beneficiaries).toEqual([]);
  });

  it('returns filtered beneficiaries matching the selected biller and bill item', async () => {
    mockGetBeneficiaries.mockResolvedValue([MOCK_BENEFICIARY]);
    mockFilterBeneficiaries.mockReturnValue([MOCK_BENEFICIARY]);

    const useBillFormController = await importController();
    const { result } = renderHook(() => useBillFormController(makeProps()));

    // Select a biller so the hook computes beneficiaries
    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });

    // Wait for the getBeneficiaries effect to settle
    await waitFor(() => {
      expect(mockFilterBeneficiaries).toHaveBeenCalled();
    });

    expect(result.current.beneficiaries).toEqual([MOCK_BENEFICIARY]);
  });

  it('handleSelectBeneficiary sets customerId and resets verification', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() => useBillFormController(makeProps()));

    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });

    act(() => {
      result.current.handleSelectBeneficiary(MOCK_BENEFICIARY);
    });

    expect(result.current.customerId).toBe('43901766923');
    // Verification should be reset (canShowPayment stays false)
    expect(result.current.canShowPayment).toBe(false);
    expect(result.current.isRepeatPaymentActive).toBe(false);
  });

  it('calls saveBeneficiary after successful verification with customerName', async () => {
    const useBillFormController = await importController();

    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({
          initialBillerName: 'EKEDC NG',
          initialCustomerIdentifier: '43901766923',
        })
      )
    );

    // Select biller + enter customer ID + trigger verify
    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });
    act(() => {
      result.current.updateCustomerId('43901766923');
    });
    act(() => {
      result.current.handleVerify();
    });

    // Simulate verify returning a successful result
    triggerVerifySuccess({
      customerName: 'VERIFIED OWNER',
      message: 'ok',
      verified: true,
    });

    await waitFor(() => {
      // Signature: saveBeneficiary(authenticatedCustomerId, input)
      expect(mockSaveBeneficiary).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          billerId: 'ekedc',
          billerName: 'EKEDC NG',
          customerId: '43901766923',
          customerName: 'VERIFIED OWNER',
        })
      );
    });
  });

  it('ignores stale getBeneficiaries results when the auth user changes mid-flight', async () => {
    // Customer A's getBeneficiaries promise stays pending while we switch
    // to Customer B. When A's resolution finally lands it must NOT overwrite
    // B's already-loaded state.
    let resolveCustomerA: (value: UtilityBeneficiary[]) => void = () => {};
    const customerAPromise = new Promise<UtilityBeneficiary[]>((resolve) => {
      resolveCustomerA = resolve;
    });
    const CUSTOMER_A_BENEFICIARY: UtilityBeneficiary = {
      ...MOCK_BENEFICIARY,
      id: 'A:ekedc:123',
      customerId: '123',
      customerName: 'CUSTOMER A',
    };
    const CUSTOMER_B_BENEFICIARY: UtilityBeneficiary = {
      ...MOCK_BENEFICIARY,
      id: 'B:ekedc:456',
      customerId: '456',
      customerName: 'CUSTOMER B',
    };

    mockGetBeneficiaries.mockImplementation(
      async (authId: unknown): Promise<UtilityBeneficiary[]> => {
        if (authId === 'customer-A') return customerAPromise;
        if (authId === 'customer-B') return [CUSTOMER_B_BENEFICIARY];
        return [];
      }
    );
    mockFilterBeneficiaries.mockImplementation((arr) => arr);

    mockAuthCustomer = { id: 'customer-A' };
    const useBillFormController = await importController();
    const { result, rerender } = renderHook(() =>
      useBillFormController(makeProps())
    );

    // Switch to customer B BEFORE customer A's promise resolves
    mockAuthCustomer = { id: 'customer-B' };
    rerender({});

    // Now resolve customer A's stale promise — it must be ignored
    resolveCustomerA([CUSTOMER_A_BENEFICIARY]);

    // Select biller so beneficiaries flow through filter
    act(() => {
      result.current.handleBillerSelect(MOCK_BILLER as never);
    });

    await waitFor(() => {
      expect(mockFilterBeneficiaries).toHaveBeenCalledWith(
        [CUSTOMER_B_BENEFICIARY],
        'ekedc',
        'ekedc'
      );
    });
    // The stale customer-A result must NOT have made it into state.
    expect(mockFilterBeneficiaries).not.toHaveBeenCalledWith(
      [CUSTOMER_A_BENEFICIARY],
      expect.anything(),
      expect.anything()
    );
  });

  it('updateCustomerId clears repeat-payment mode and verification', async () => {
    const useBillFormController = await importController();
    const { result } = renderHook(() =>
      useBillFormController(
        makeProps({
          initialCustomerIdentifier: '43901766923',
          initialCustomerName: 'PREFILLED OWNER',
        })
      )
    );

    // Activate repeat-payment mode (handleBillerSelect would itself
    // deactivate it, so we activate AFTER any other setup).
    act(() => {
      result.current.setRepeatPaymentActive(true);
    });
    expect(result.current.isRepeatPaymentActive).toBe(true);
    expect(result.current.verifiedCustomerName).toBe('PREFILLED OWNER');

    // Editing the meter number must invalidate the prior verification AND
    // exit repeat-payment mode so canShowPayment can't stay true with
    // stale state attached to the previous identifier.
    act(() => {
      result.current.updateCustomerId('43900000000');
    });
    expect(result.current.isRepeatPaymentActive).toBe(false);
    expect(result.current.verifiedCustomerName).toBeNull();
    expect(result.current.canShowPayment).toBe(false);
  });
});
