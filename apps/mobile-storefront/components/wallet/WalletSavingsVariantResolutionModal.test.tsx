import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsVariantResolutionModal } from './WalletSavingsVariantResolutionModal';

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: (reason: Error) => {
      if (!rejectPromise)
        throw new Error('Deferred promise was not initialized.');
      rejectPromise(reason);
    },
    resolve: (value: T) => {
      if (!resolvePromise) {
        throw new Error('Deferred promise was not initialized.');
      }
      resolvePromise(value);
    },
  };
}

describe('WalletSavingsVariantResolutionModal', () => {
  it.each([
    false,
    true,
  ])('ignores a late rejection after external dismissal (reopened: %s)', async (reopened) => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    try {
      const deferred = createDeferred<boolean>();
      const props = {
        colors: Colors.light,
        onClose: jest.fn(),
        onResolve: jest.fn(() => deferred.promise),
        options: [{ id: 'variant-1', label: 'First goal' }],
      };
      const view = render(
        <WalletSavingsVariantResolutionModal {...props} visible />
      );
      fireEvent.press(
        screen.getByRole('button', {
          name: 'Resolve savings variant First goal',
        })
      );
      view.rerender(
        <WalletSavingsVariantResolutionModal {...props} visible={false} />
      );
      if (reopened) {
        view.rerender(
          <WalletSavingsVariantResolutionModal
            {...props}
            options={[{ id: 'variant-2', label: 'Next goal' }]}
            visible
          />
        );
      }
      await act(async () => deferred.reject(new Error('Late failure')));
      expect(alert).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });

  it('still alerts for the current session and allows retry to succeed', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    try {
      const deferred = createDeferred<boolean>();
      const onClose = jest.fn();
      const onResolve = jest
        .fn(() => deferred.promise)
        .mockImplementationOnce(() => deferred.promise)
        .mockResolvedValueOnce(true);
      render(
        <WalletSavingsVariantResolutionModal
          colors={Colors.light}
          onClose={onClose}
          onResolve={onResolve}
          options={[{ id: 'variant-1', label: 'Current goal' }]}
          visible
        />
      );
      fireEvent.press(
        screen.getByRole('button', {
          name: 'Resolve savings variant Current goal',
        })
      );
      await act(async () => deferred.reject(new Error('Current failure')));
      expect(alert).toHaveBeenCalledWith(
        'Unable to resolve variant',
        'Please try again or refresh your savings goal.'
      );
      expect(onClose).not.toHaveBeenCalled();
      await act(async () =>
        fireEvent.press(
          screen.getByRole('button', {
            name: 'Resolve savings variant Current goal',
          })
        )
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      alert.mockRestore();
    }
  });

  it('submits only once when two presses happen before the pending render', async () => {
    const deferred = createDeferred<boolean>();
    const onResolve = jest.fn(() => deferred.promise);
    render(
      <WalletSavingsVariantResolutionModal
        colors={Colors.light}
        onClose={jest.fn()}
        onResolve={onResolve}
        options={[{ id: 'variant-1', label: 'New · Black · 256GB' }]}
        visible
      />
    );

    const button = screen.getByRole('button', {
      name: 'Resolve savings variant New · Black · 256GB',
    });
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(onResolve).toHaveBeenCalledTimes(1);
    await act(async () => deferred.resolve(false));
  });

  it('shows an actionable empty state when no safe variants remain', () => {
    render(
      <WalletSavingsVariantResolutionModal
        colors={Colors.light}
        onClose={jest.fn()}
        onResolve={jest.fn(async () => false)}
        options={[]}
        visible
      />
    );

    expect(
      screen.getByText(
        'No eligible variants are available. Refresh and contact support if this continues.'
      )
    ).toBeOnTheScreen();
  });
});
