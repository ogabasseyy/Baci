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
        justEarned={false}
        roomBlocked={false}
        watchAd={watchAd}
        watchFailed={false}
      />
    );

    expect(screen.getByText('Earn a badge')).toBeTruthy();
    expect(
      screen.getByText('Watch a short ad to earn today’s quiz badge')
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
        justEarned={false}
        roomBlocked={false}
        watchAd={jest.fn()}
        watchFailed={false}
      />
    );

    expect(screen.queryByText('Earn a badge')).toBeNull();
  });

  it('marks Watch ad disabled while the ad is loading', () => {
    render(
      <QuizRewardedBadgeOffer
        available
        dismiss={jest.fn()}
        isWatching
        justEarned={false}
        roomBlocked={false}
        watchAd={jest.fn()}
        watchFailed={false}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Watch ad' })
    ).toHaveAccessibilityState({
      disabled: true,
    });
  });

  it('shows retry guidance when the ad fails to load', () => {
    render(
      <QuizRewardedBadgeOffer
        available
        dismiss={jest.fn()}
        isWatching={false}
        justEarned={false}
        roomBlocked={false}
        watchAd={jest.fn()}
        watchFailed
      />
    );

    expect(screen.getByText('Couldn’t load the ad. Try again.')).toBeTruthy();
  });

  it('confirms the earned badge with a dismiss action', () => {
    const dismiss = jest.fn();
    render(
      <QuizRewardedBadgeOffer
        available
        dismiss={dismiss}
        isWatching={false}
        justEarned
        roomBlocked={false}
        watchAd={jest.fn()}
        watchFailed={false}
      />
    );

    expect(screen.getByText('Badge earned!')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Close badge confirmation' })
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
