import type { User } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCheckoutFormSession } from './use-checkout-form-session';

function customer(userMetadata: User['user_metadata']): User {
  return {
    id: 'customer-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'ada@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: userMetadata,
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('useCheckoutFormSession', () => {
  beforeEach(() => sessionStorage.clear());

  it('holds navigation at contact until persisted checkout state is hydrated', () => {
    sessionStorage.setItem(
      'checkout-form',
      JSON.stringify({
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      })
    );
    const { result, rerender } = renderHook(
      ({ isHydrated }) => useCheckoutFormSession({ isHydrated, user: null }),
      { initialProps: { isHydrated: false } }
    );

    expect(result.current.form.values.currentStep).toBe('payment');
    expect(result.current.flow.currentStep).toBe('contact');
    expect(result.current.flow.completedSteps).toEqual({
      contact: false,
      delivery: false,
    });

    rerender({ isHydrated: true });
    expect(result.current.flow.currentStep).toBe('payment');
    expect(result.current.flow.completedSteps).toEqual({
      contact: true,
      delivery: true,
    });
  });

  it('persists contact and step transitions while exposing form clearing', () => {
    const checkout = renderHook(() =>
      useCheckoutFormSession({ isHydrated: true, user: null })
    );
    act(() =>
      checkout.result.current.form.setField(
        'customerEmail',
        'buyer@example.test'
      )
    );
    act(() => checkout.result.current.flow.completeContact());

    expect(checkout.result.current.flow.currentStep).toBe('delivery');
    expect(checkout.result.current.flow.completedSteps.contact).toBe(true);
    act(() => window.dispatchEvent(new Event('pagehide')));
    checkout.unmount();

    const restored = renderHook(() =>
      useCheckoutFormSession({ isHydrated: true, user: null })
    );
    expect(restored.result.current.form.contactValues.customerEmail).toBe(
      'buyer@example.test'
    );
    expect(restored.result.current.flow.currentStep).toBe('delivery');
    expect(restored.result.current.flow.completedSteps.contact).toBe(true);

    act(() => restored.result.current.form.clear());
    expect(restored.result.current.flow.currentStep).toBe('contact');
    expect(restored.result.current.form.values.customerEmail).toBe('');
  });

  it('prefills blank fields, ignores malformed profile values, and preserves entered contact', async () => {
    const { result } = renderHook(() =>
      useCheckoutFormSession({
        isHydrated: true,
        user: customer({
          first_name: 42,
          full_name: false,
          name: 7,
          phone: false,
        }),
      })
    );

    await waitFor(() =>
      expect(result.current.form.values.customerEmail).toBe('ada@example.test')
    );
    expect(result.current.form.contactValues.firstName).toBe('');
    expect(result.current.form.contactValues.lastName).toBe('');
    expect(result.current.form.values.customerPhone).toBe('');

    act(() =>
      result.current.form.setFields({
        firstName: 'Shopper',
        customerEmail: 'entered@example.test',
      })
    );
    expect(result.current.flow.signedIn).toBe(true);
    expect(result.current.form.contactValues).toMatchObject({
      firstName: 'Shopper',
      customerEmail: 'entered@example.test',
    });
  });

  it('keeps account and auth-modal state transient across session remounts', () => {
    const checkout = renderHook(() =>
      useCheckoutFormSession({ isHydrated: true, user: null })
    );
    act(() => {
      checkout.result.current.account.setCreateAccount(true);
      checkout.result.current.account.setPassword('secure-pass');
      checkout.result.current.auth.open();
    });
    expect(checkout.result.current.account.createAccount).toBe(true);
    expect(checkout.result.current.auth.isOpen).toBe(true);
    act(() => checkout.result.current.auth.onOpenChange(false));
    expect(checkout.result.current.auth.isOpen).toBe(false);
    checkout.unmount();

    const restored = renderHook(() =>
      useCheckoutFormSession({ isHydrated: true, user: null })
    );
    expect(restored.result.current.account.createAccount).toBe(false);
    expect(restored.result.current.account.password).toBe('');
    expect(restored.result.current.auth.isOpen).toBe(false);
  });
});
