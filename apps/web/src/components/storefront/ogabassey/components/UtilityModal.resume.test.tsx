import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UTILITY_PENDING_INTENT_STORAGE_KEY } from './use-utility-pending-intent';
import { utilityModalTestHarness as harness } from './utility-modal-test-support';
import { UtilityModal } from './UtilityModal';

/**
 * Resume of the utility purchase a wallet-funding detour interrupts. The
 * modal's checkout and rendering behaviour live in `UtilityModal.checkout.test`
 * and `UtilityModal.test`; kept separate for the 300-line modularity budget.
 */
// The harness signs in `customer-1`; a resumable intent is scoped to that id.
const storedIntent = {
  amount: '500',
  customerId: 'customer-1',
  networkProvider: 'MTN',
  phoneNumber: '08012345678',
  tab: 'airtime' as const,
};

function renderOpenModal() {
  return render(<UtilityModal isOpen={true} onClose={harness.onClose} />);
}

function storedIntentValue(): unknown {
  return JSON.parse(
    sessionStorage.getItem(UTILITY_PENDING_INTENT_STORAGE_KEY) ?? 'null'
  );
}

/** Installs a trivial in-process Web Locks stand-in for the mint runner. */
function installTestLockManager(): void {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    writable: true,
    value: {
      request: async (_name: string, callback: () => unknown) => callback(),
    },
  });
}

describe('UtilityModal funding-detour resume', () => {
  beforeEach(() => {
    // Locks first (R152 P1): completing a purchase mints under the
    // runner, which fails closed in a lockless jsdom browser.
    installTestLockManager();
    harness.reset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  describe('with the dark-launch flag off', () => {
    it('never prefills and never persists a draft', () => {
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify(storedIntent)
      );

      renderOpenModal();

      expect(screen.getByTestId('airtime-data-form')).toHaveAttribute(
        'data-initial-amount',
        ''
      );
      expect(
        screen.queryByRole('button', { name: 'Mock Draft Change' })
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mock Draft Change' }));
      expect(storedIntentValue()).toEqual(storedIntent);
    });
  });

  describe('with the dark-launch flag on', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_WALLET_FUNDING_CHECK_LOOP_ENABLED', 'true');
    });

    it('prefills the paused purchase without auto-submitting it', () => {
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify(storedIntent)
      );

      renderOpenModal();

      const form = screen.getByTestId('airtime-data-form');
      expect(form).toHaveAttribute('data-initial-amount', '500');
      expect(form).toHaveAttribute('data-initial-phone', '08012345678');
      // Prefill only: no checkout call fires without the customer pressing Pay.
      expect(harness.checkoutFetch).not.toHaveBeenCalled();
    });

    it('resumes a non-default (data) tab draft onto its own tab and prefills it', () => {
      // Regression: AirtimeDataForm shares one JSX slot for the airtime and
      // data tabs, so before the per-tab remount + tab-seed fix a stored
      // `tab: 'data'` draft could never prefill — the modal reopened on the
      // default `airtime` tab and the form was never remounted for `data`.
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify({ ...storedIntent, amount: '1200', tab: 'data' })
      );

      renderOpenModal();

      const form = screen.getByTestId('airtime-data-form');
      // Landed on the DATA tab, not the default airtime tab...
      expect(form).toHaveAttribute('data-type', 'data');
      // ...and the saved draft actually prefilled it.
      expect(form).toHaveAttribute('data-initial-amount', '1200');
      expect(form).toHaveAttribute('data-initial-phone', '08012345678');
      expect(harness.checkoutFetch).not.toHaveBeenCalled();
    });

    it('persists the in-progress draft so it survives the funding detour', async () => {
      vi.useFakeTimers();
      renderOpenModal();

      act(() => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Mock Draft Change' })
        );
      });
      act(() => {
        // usePersistedState debounces its storage write by 300ms.
        vi.advanceTimersByTime(1_000);
      });

      expect(storedIntentValue()).toEqual({
        amount: '750',
        customerId: 'customer-1',
        networkProvider: 'MTN',
        phoneNumber: '08012345678',
        tab: 'airtime',
      });
      vi.useRealTimers();
    });

    it('reseeds the draft once the customer id hydrates after the modal mounts open', () => {
      // Reload / background-tab-eviction case: the modal renders already-open
      // before CustomerAuthProvider resolves the signed-in customer. On that
      // first render `customer.id` is absent, so the stored intent is not yet
      // owned and the form mounts empty. Once auth hydrates the owning
      // customer, the draft must be reseeded — the render-time reset keyed on
      // isOpen/initialTab does not re-run, so a dedicated reseed path is needed.
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify(storedIntent)
      );

      harness.useAuth.mockReturnValue({
        customer: null,
        isAuthenticated: false,
        isLoading: true,
        user: null,
      });
      const { rerender } = renderOpenModal();

      // Identity unknown: the stored draft is not yet owned, so nothing shows.
      expect(screen.getByTestId('airtime-data-form')).toHaveAttribute(
        'data-initial-amount',
        ''
      );

      // Auth resolves to the owning customer (customer-1).
      harness.useAuth.mockReturnValue({
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
      rerender(<UtilityModal isOpen={true} onClose={harness.onClose} />);

      const form = screen.getByTestId('airtime-data-form');
      expect(form).toHaveAttribute('data-initial-amount', '500');
      expect(form).toHaveAttribute('data-initial-phone', '08012345678');
      // Prefill only — no auto-submit fires from the late reseed.
      expect(harness.checkoutFetch).not.toHaveBeenCalled();
    });

    it('does not remount the airtime form when a signed-in customer saves the first draft', () => {
      // Regression: the late-hydration reseed path must fire ONLY when the
      // customer id transitions absent -> present (auth resolving after the
      // modal mounted open). For a customer who is already signed in with no
      // stored draft, typing the first character saves a draft, which flips
      // `intent` non-null. If the reseed branch also fired here it would bump
      // the form remount key and unmount/remount AirtimeDataForm on the first
      // keystroke — dropping input focus (dismissing the mobile keyboard). The
      // form must stay the SAME mounted instance across that first save.
      const { getByTestId } = renderOpenModal();
      const form = getByTestId('airtime-data-form');
      const instanceBefore = form.getAttribute('data-instance');

      fireEvent.click(screen.getByRole('button', { name: 'Mock Draft Change' }));

      expect(getByTestId('airtime-data-form').getAttribute('data-instance')).toBe(
        instanceBefore
      );
    });

    it('never prefills a different customer\'s stored intent', () => {
      // An intent left by another customer on this shared tab must not leak
      // into the currently signed-in customer's (customer-1) money form.
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify({ ...storedIntent, customerId: 'someone-else' })
      );

      renderOpenModal();

      expect(screen.getByTestId('airtime-data-form')).toHaveAttribute(
        'data-initial-amount',
        ''
      );
    });

    it('clears the persisted draft when the modal is closed without funding', async () => {
      // Regression: the resume snapshot was only cleared after a SUCCESSFUL
      // checkout, so abandoning the form — closing the modal without entering
      // the funding detour — left a stale draft that silently reseeded (and
      // could be Paid at) a later, unrelated purchase. A deliberate close now
      // drops it. (Reload / tab-eviction, the real resume path, never closes.)
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify(storedIntent)
      );
      renderOpenModal();
      // The draft is present and prefilled before the close.
      expect(screen.getByTestId('airtime-data-form')).toHaveAttribute(
        'data-initial-amount',
        '500'
      );

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      await waitFor(() => {
        expect(storedIntentValue()).toBeNull();
      });
    });

    it('clears the resume snapshot once the purchase completes', async () => {
      sessionStorage.setItem(
        UTILITY_PENDING_INTENT_STORAGE_KEY,
        JSON.stringify(storedIntent)
      );
      renderOpenModal();

      fireEvent.click(screen.getByRole('button', { name: 'Mock Submit' }));

      await waitFor(() => {
        expect(storedIntentValue()).toBeNull();
      });
    });
  });
});
