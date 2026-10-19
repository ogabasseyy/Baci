import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { DependencyList, EffectCallback } from 'react';
import Colors from '@/constants/Colors';
import { PiggyvestDraftReview } from './PiggyvestSavingsScreen.review';

let mockDeferCleanup = false;
const mockDeferredCleanups: Array<() => void> = [];
jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (effect: EffectCallback, dependencies?: DependencyList) =>
      actual.useEffect(() => {
        const cleanup = effect();
        return () => {
          if (typeof cleanup !== 'function') return;
          if (mockDeferCleanup) mockDeferredCleanups.push(cleanup);
          else cleanup();
        };
      }, dependencies),
  };
});

const draft = {
  status: 'draft' as const,
  goalId: '11111111-1111-4111-8111-111111111111',
  revisionId: '22222222-2222-4222-8222-222222222222',
  device: { productName: 'Synthetic phone', variant: null, condition: 'New' },
  terms: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic reviewed terms.',
  },
  consent: 'required' as const,
};

describe('native draft review callback lifetime', () => {
  it('resets same-revision duration consent and ignores old completion', async () => {
    let complete: () => void = () => undefined;
    const onAccept = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const view = render(
      <PiggyvestDraftReview
        draft={{ ...draft, durationMonths: 3 }}
        colors={Colors.light}
        onAccept={onAccept}
      />
    );
    expect(screen.getByText('Duration: 3 months')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByRole('button', { name: 'Accept draft terms' }));
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ durationMonths: 3 })
    );
    view.rerender(
      <PiggyvestDraftReview
        draft={{ ...draft, durationMonths: 4 }}
        colors={Colors.light}
        onAccept={onAccept}
      />
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
      checked: false,
    });
    await act(async () => {
      complete();
    });
    expect(
      screen.queryByText(
        'Acceptance submitted. Refresh to confirm recorded consent.'
      )
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Accept draft terms' })
    ).toBeDisabled();
  });
  it.each([
    'success',
    'failure',
  ])('ignores old %s settling after replacement render but before passive cleanup', async (outcome) => {
    let complete: () => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const oldAccept = jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        })
    );
    const nextAccept = jest.fn(async () => undefined);
    mockDeferCleanup = true;
    const view = render(
      <PiggyvestDraftReview
        draft={draft}
        colors={Colors.light}
        onAccept={oldAccept}
      />
    );
    try {
      fireEvent.press(screen.getByRole('checkbox'));
      fireEvent.press(
        screen.getByRole('button', { name: 'Accept draft terms' })
      );
      view.rerender(
        <PiggyvestDraftReview
          draft={draft}
          colors={Colors.light}
          onAccept={nextAccept}
        />
      );
      await act(async () => {
        if (outcome === 'success') complete();
        else fail(new Error('old response'));
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        screen.queryByText(
          'Acceptance submitted. Refresh to confirm recorded consent.'
        )
      ).toBeNull();
      expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
        checked: false,
      });
    } finally {
      view.unmount();
      mockDeferCleanup = false;
      mockDeferredCleanups.splice(0).forEach((cleanup) => {
        cleanup();
      });
    }
  });
  it('resets on callback replacement and ignores an old rejected acceptance', async () => {
    let reject: (error: Error) => void = () => undefined;
    const oldAccept = jest.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    );
    const nextAccept = jest.fn(async () => undefined);
    const view = render(
      <PiggyvestDraftReview
        draft={draft}
        colors={Colors.light}
        onAccept={oldAccept}
      />
    );
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByRole('button', { name: 'Accept draft terms' }));
    view.rerender(
      <PiggyvestDraftReview
        draft={draft}
        colors={Colors.light}
        onAccept={nextAccept}
      />
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
      checked: false,
    });
    await act(async () => {
      reject(new Error('Private old error'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.press(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Accept draft terms' })
      );
    });
    expect(nextAccept).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'Acceptance submitted. Refresh to confirm recorded consent.'
      )
    ).toBeOnTheScreen();
  });
});
