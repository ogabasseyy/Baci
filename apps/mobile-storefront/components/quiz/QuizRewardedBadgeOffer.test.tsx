import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizRewardedBadgeOffer } from './QuizRewardedBadgeOffer';

describe('QuizRewardedBadgeOffer', () => {
  it('uses the required opt-in copy and actions', () => {
    const watchAd = jest.fn();
    const dismiss = jest.fn();

    render(
      <QuizRewardedBadgeOffer
        available
        dismiss={dismiss}
        isWatching={false}
        roomBlocked={false}
        watchAd={watchAd}
      />
    );

    expect(screen.getByText('Unlock a SuperQuiz profile badge')).toBeTruthy();
    expect(
      screen.getByText('Watch a short ad to unlock today’s quiz badge')
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Watch ad' }));
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(watchAd).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the rewarded placement is unavailable', () => {
    render(
      <QuizRewardedBadgeOffer
        available={false}
        dismiss={jest.fn()}
        isWatching={false}
        roomBlocked={false}
        watchAd={jest.fn()}
      />
    );

    expect(screen.queryByText('Unlock a SuperQuiz profile badge')).toBeNull();
  });

  it('marks Watch ad disabled while the ad is loading', () => {
    render(
      <QuizRewardedBadgeOffer
        available
        dismiss={jest.fn()}
        isWatching
        roomBlocked={false}
        watchAd={jest.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Watch ad' })
    ).toHaveAccessibilityState({
      disabled: true,
    });
  });
});
