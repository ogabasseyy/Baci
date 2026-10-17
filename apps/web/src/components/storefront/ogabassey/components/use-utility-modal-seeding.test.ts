import { renderHook } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useCustomerFormReset } from './use-customer-form-reset';
import type { UtilityPurchaseStep } from './use-utility-purchase';
import { useUtilityModalFormSeeding } from './use-utility-modal-seeding';
import type { UtilityTabId } from './UtilityTabs';

describe('useUtilityModalFormSeeding', () => {
  const intent = {
    amount: '100',
    networkProvider: 'MTN',
    phoneNumber: '08012345678',
    tab: 'data' as const,
  };

  function setup(overrides: {
    closeFundingPanel?: () => void;
    customerChanged?: boolean;
    initialTab?: UtilityTabId;
    intent?: typeof intent | null;
    isOpen?: boolean;
    setActiveTab?: (tab: UtilityTabId) => void;
    setStep?: (step: 'details') => void;
  } = {}) {
    const props = {
      closeFundingPanel: overrides.closeFundingPanel ?? vi.fn(),
      customerChanged: overrides.customerChanged ?? false,
      initialTab: (overrides.initialTab ?? 'airtime') as UtilityTabId,
      intent: overrides.intent === undefined ? intent : overrides.intent,
      isOpen: overrides.isOpen ?? true,
      setActiveTab: overrides.setActiveTab ?? vi.fn(),
      setStep: (overrides.setStep ?? vi.fn()) as Dispatch<
        SetStateAction<UtilityPurchaseStep>
      >,
    };
    const rendered = renderHook((p) => useUtilityModalFormSeeding(p), {
      initialProps: props,
    });
    return { ...rendered, props };
  }

  it('lands on the resumed draft tab and collapses funding on open', () => {
    const setActiveTab = vi.fn();
    const setStep = vi.fn();
    const closeFundingPanel = vi.fn();

    const { result } = setup({
      closeFundingPanel,
      initialTab: 'airtime',
      setActiveTab,
      setStep,
    });

    // A `data` draft is not stranded on the default `airtime` tab.
    expect(setActiveTab).toHaveBeenCalledWith('data');
    expect(setStep).toHaveBeenCalledWith('details');
    expect(closeFundingPanel).toHaveBeenCalledTimes(1);
    expect(result.current.appliedIntentKey).toBe(
      'data|100|08012345678|MTN'
    );
  });

  it('falls back to the initial tab when no draft is owned', () => {
    const setActiveTab = vi.fn();

    const { result } = setup({
      initialTab: 'power',
      intent: null,
      setActiveTab,
    });

    expect(setActiveTab).toHaveBeenCalledWith('power');
    expect(result.current.appliedIntentKey).toBeNull();
  });

  it('re-seeds when the customer changes while open', () => {
    // Drive the transient flag through the real useCustomerFormReset:
    // holding customerChanged=true across renders would re-fire every
    // pass (in production the flag self-clears the same render).
    const setActiveTab = vi.fn();
    const setStep = vi.fn();
    const { rerender } = renderHook(
      ({ customerId }: { customerId: string | undefined }) => {
        const { customerChanged } = useCustomerFormReset(customerId);
        return useUtilityModalFormSeeding({
          closeFundingPanel: vi.fn(),
          customerChanged,
          initialTab: 'airtime' as UtilityTabId,
          intent,
          isOpen: true,
          setActiveTab,
          setStep: setStep as Dispatch<
            SetStateAction<UtilityPurchaseStep>
          >,
        });
      },
      { initialProps: { customerId: 'customer-1' as string | undefined } }
    );
    setActiveTab.mockClear();
    setStep.mockClear();

    rerender({ customerId: 'customer-2' });

    expect(setActiveTab).toHaveBeenCalledWith('data');
    expect(setStep).toHaveBeenCalledWith('details');
  });

  it('does not re-seed on unrelated re-renders', () => {
    const setActiveTab = vi.fn();
    const { rerender, props } = setup({ setActiveTab });
    setActiveTab.mockClear();

    rerender(props);

    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('re-arms seeding when the modal closes', () => {
    const { rerender, result } = setup({ isOpen: true });
    expect(result.current.appliedIntentKey).not.toBeNull();

    rerender({
      closeFundingPanel: vi.fn(),
      customerChanged: false,
      initialTab: 'airtime' as UtilityTabId,
      intent,
      isOpen: false,
      setActiveTab: vi.fn(),
      setStep: vi.fn(),
    });

    expect(result.current.appliedIntentKey).toBeNull();
  });
});
