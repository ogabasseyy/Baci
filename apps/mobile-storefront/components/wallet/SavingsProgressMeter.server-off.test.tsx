import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsProgressMeter } from './SavingsProgressMeter';

type InspectableInterpolation = { __getValue: () => string };

describe('SavingsProgressMeter', () => {
  it('exposes the percentage as a progress bar', () => {
    render(
      <SavingsProgressMeter
        accessibilityLabel="Savings plan progress"
        colors={Colors.light}
        percent={40}
      />
    );
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress' })
    ).toHaveAccessibilityValue({ max: 100, min: 0, now: 40 });
  });

  it.each([
    true,
    false,
  ])('updates the rendered fill to the new percentage with reduce motion %s', async (reduceMotion) => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(reduceMotion);
    jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => ({
      reset: jest.fn(),
      start: () => {
        (_value as Animated.Value).setValue(config.toValue as number);
      },
      stop: jest.fn(),
    }));
    const { rerender, UNSAFE_getByType } = render(
      <SavingsProgressMeter
        accessibilityLabel="Progress"
        colors={Colors.dark}
        percent={0}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole('progressbar', { name: 'Progress' })
      ).toHaveAccessibilityValue({ now: 0 })
    );

    rerender(
      <SavingsProgressMeter
        accessibilityLabel="Progress"
        colors={Colors.dark}
        percent={100}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole('progressbar', { name: 'Progress' })
      ).toHaveAccessibilityValue({ now: 100 })
    );
    const fillStyle = StyleSheet.flatten(
      UNSAFE_getByType(Animated.View).props.style
    );
    expect((fillStyle.width as InspectableInterpolation).__getValue()).toBe(
      '100%'
    );
  });
});
