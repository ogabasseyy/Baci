import { useState } from 'react';
import { vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';

const {
  mockAirtimeMountCount,
  mockAirtimeSubmitAmount,
  mockBillMountCount,
  mockCaptureClientEvent,
  mockFetchWithCsrf,
  mockUseCustomerAuth,
  mockUseWallet,
} = vi.hoisted(() => ({
  mockAirtimeMountCount: { current: 0 },
  mockAirtimeSubmitAmount: { current: 100 },
  mockBillMountCount: { current: 0 },
  mockCaptureClientEvent: vi.fn(),
  mockFetchWithCsrf: vi.fn(),
  mockUseCustomerAuth: vi.fn(),
  mockUseWallet: vi.fn(),
}));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: mockCaptureClientEvent,
}));

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

vi.mock('./utility/AirtimeDataForm', () => ({
  AirtimeDataForm: ({
    initialDraft,
    loading,
    onDraftChange,
    onSubmit,
    type,
  }: {
    initialDraft?: {
      amount: string;
      networkProvider: string | null;
      phoneNumber: string;
    };
    loading: boolean;
    onDraftChange?: (draft: {
      amount: string;
      networkProvider: string | null;
      phoneNumber: string;
    }) => void;
    onSubmit: (data: Record<string, unknown>) => void;
    type: string;
  }) => {
    // A fresh instance id is minted only on MOUNT (lazy useState initializer),
    // mirroring the real AirtimeDataForm reading `initialDraft` once via
    // `useState`. A key change remounts and bumps this id; a plain re-render
    // does not — letting tests assert whether a form was remounted (and thus
    // would have lost input focus) versus merely re-rendered.
    const instance = useState(() => {
      mockAirtimeMountCount.current += 1;
      return mockAirtimeMountCount.current;
    })[0];
    return (
    <div
      data-testid="airtime-data-form"
      data-type={type}
      data-loading={String(loading)}
      data-instance={String(instance)}
      data-initial-amount={initialDraft?.amount ?? ''}
      data-initial-phone={initialDraft?.phoneNumber ?? ''}
    >
      <button
        type="button"
        onClick={() =>
          onDraftChange?.({
            amount: '750',
            networkProvider: 'MTN',
            phoneNumber: '08012345678',
          })
        }
      >
        Mock Draft Change
      </button>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            amount: mockAirtimeSubmitAmount.current,
            networkProvider: 'MTN',
            phoneNumber: '08012345678',
          })
        }
      >
        Mock Submit
      </button>
    </div>
    );
  },
}));

vi.mock('./utility/BillPaymentForm', () => ({
  BillPaymentForm: ({
    loading,
    onSubmit,
    type,
  }: {
    loading: boolean;
    onSubmit: (data: Record<string, unknown>) => void;
    type: string;
  }) => {
    // Fresh instance id per MOUNT (see AirtimeDataForm mock), so a test can
    // assert the bill form remounts — and thus drops customer A's typed
    // meter/smartcard id, amount and verified address — on a customer switch.
    const instance = useState(() => {
      mockBillMountCount.current += 1;
      return mockBillMountCount.current;
    })[0];
    return (
      <div
        data-testid="bill-payment-form"
        data-type={type}
        data-loading={String(loading)}
        data-instance={String(instance)}
      >
        <button
          type="button"
          onClick={() =>
            onSubmit({
              amount: 5000,
              billerName: 'DStv',
              billItemIdentifier: 'DSTV',
              customerIdentifier: '123',
              type: 'cable_tv',
            })
          }
        >
          Mock Bill Submit
        </button>
      </div>
    );
  },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'ogabassey' } }),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => mockUseCustomerAuth(),
}));

vi.mock('@/components/storefront/ogabassey/pages/checkout/hooks/use-wallet', () => ({
  useWallet: () => mockUseWallet(),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

function createJsonResponse(
  body: Record<string, unknown>,
  init: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const mockOnClose = vi.fn();

export const utilityModalTestHarness = {
  amount: mockAirtimeSubmitAmount,
  captureEvent: mockCaptureClientEvent,
  checkoutFetch: vi.mocked(fetchWithCsrf),
  createJsonResponse,
  onClose: mockOnClose,
  toast: vi.mocked(toast),
  useAuth: mockUseCustomerAuth,
  useWallet: mockUseWallet,
  reset() {
    mockOnClose.mockClear();
    this.toast.mockClear();
    this.checkoutFetch.mockReset();
    mockCaptureClientEvent.mockReset();
    mockAirtimeMountCount.current = 0;
    mockBillMountCount.current = 0;
    mockAirtimeSubmitAmount.current = 100;
    mockUseCustomerAuth.mockReturnValue({
      customer: {
        id: 'customer-1',
        email: 'customer@example.com',
        first_name: 'Test',
        last_name: 'Customer',
        phone: '08012345678',
      },
      isAuthenticated: true,
      isLoading: false,
      user: {
        email: 'customer@example.com',
        id: 'user-1',
        role: 'customer',
      },
    });
    mockUseWallet.mockReturnValue({
      payWithWallet: true,
      setPayWithWallet: vi.fn(),
      setWalletBalance: vi.fn(),
      walletBalance: 500,
      walletLoading: false,
    });
    this.checkoutFetch.mockResolvedValue(
      createJsonResponse({
        amount: 100,
        reference: 'REF123456',
        status: 'successful',
      })
    );
  },
};
