import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreSettingsFormValues } from '@/components/store-settings/store-settings-payload';
import type { StatusModalState } from '@/components/ui/StatusModal';

const mocks = vi.hoisted(() => ({
  invalidateAfterSave: vi.fn().mockResolvedValue(undefined),
  updateMerchant: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/merchant-settings', () => ({
  updateMerchantIdentitySettings: mocks.updateMerchant,
}));

vi.mock('@/lib/store-settings-save-readiness', () => ({
  invalidateStoreSettingsAfterSave: mocks.invalidateAfterSave,
}));

import { useStoreSettingsSaveLifecycle } from './useStoreSettingsSaveLifecycle';

const baseline: StoreSettingsFormValues = {
  business_address: '',
  business_name: 'Baci Store',
  country: 'NG',
  payout_currency: 'NGN',
  phone: '+2348146978921',
  slug: 'baci-store',
  support_email: 'support@example.com',
  support_phone: '+2348146978921',
};

function renderSaveLifecycle(formValues: StoreSettingsFormValues) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      const [statusModal, setStatusModal] = useState<StatusModalState>({
        visible: false,
        type: 'success',
        title: '',
        message: '',
      });
      const lifecycle = useStoreSettingsSaveLifecycle({
        baseline,
        formValues,
        from: undefined,
        getFormRevision: () => 0,
        merchant: { id: 'merchant-1', updated_at: '2026-10-31T09:00:00Z' },
        onRefreshedLocalSave: vi.fn(),
        queryClient,
        resetFormDirty: vi.fn(),
        router: { back: vi.fn() },
        setStatusModal,
        syncedMerchantUpdatedAt: '2026-10-31T09:00:00Z',
      });
      return { ...lifecycle, statusModal };
    },
    { wrapper }
  );
}

describe('bugfix: Store Settings saved a truncated store phone', () => {
  beforeEach(() => {
    mocks.invalidateAfterSave.mockClear();
    mocks.updateMerchant.mockClear();
  });

  it('refuses to save +23415781 and explains what to fix', () => {
    const { result } = renderSaveLifecycle({ ...baseline, phone: '+23415781' });

    act(result.current.startSave);

    expect(mocks.updateMerchant).not.toHaveBeenCalled();
    expect(result.current.isSaving).toBe(false);
    expect(result.current.statusModal).toMatchObject({
      visible: true,
      type: 'error',
      title: 'Check phone number',
      message: expect.stringContaining('Phone Number looks incomplete'),
    });
  });

  it('still saves a complete store phone', async () => {
    const { result } = renderSaveLifecycle({
      ...baseline,
      phone: '+2348031234567',
    });

    act(result.current.startSave);

    await waitFor(() => expect(mocks.updateMerchant).toHaveBeenCalledTimes(1));
    expect(mocks.updateMerchant).toHaveBeenCalledWith({
      expectedUpdatedAt: '2026-10-31T09:00:00Z',
      merchantId: 'merchant-1',
      settings: { phone: '+2348031234567' },
    });
  });
});
