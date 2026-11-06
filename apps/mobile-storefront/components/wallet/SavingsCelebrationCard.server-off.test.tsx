import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsCelebrationCard } from './SavingsCelebrationCard';

type InspectableAnimatedValue = Animated.Value & { __getValue: () => number };

describe('SavingsCelebrationCard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cheers the amount added and the progress so far', () => {
    render(
      <SavingsCelebrationCard
        celebration={{ added: 5000, percent: 42 }}
        colors={Colors.light}
      />
    );
    expect(
      screen.getByText("Nice! ₦5,000 added. You're 42% there.")
    ).toBeOnTheScreen();
  });

  it('celebrates reaching the goal', () => {
    render(
      <SavingsCelebrationCard
        celebration={{ added: 1000, percent: 100 }}
        colors={Colors.dark}
      />
    );
    expect(
      screen.getByText('Goal reached! ₦1,000 added. You did it.')
    ).toBeOnTheScreen();
  });

  it('keeps the card visible while unknown, then animates its shared translation', async () => {
    let resolvePreference!: (enabled: boolean) => void;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(
      new Promise((resolve) => {
        resolvePreference = resolve;
      })
    );
    const transitions: { from: number; to: number }[] = [];
    jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
      if (!(value instanceof Animated.Value)) {
        throw new Error('Expected a scalar celebration translation');
      }
      const sharedValue = value as InspectableAnimatedValue;
      return {
        reset: jest.fn(),
        start: () => {
          const from = sharedValue.__getValue();
          const to = config.toValue as number;
          transitions.push({ from, to });
          sharedValue.setValue(to);
        },
        stop: jest.fn(),
      };
    });

    const { UNSAFE_getByType } = render(
      <SavingsCelebrationCard
        celebration={{ added: 5000, percent: 42 }}
        colors={Colors.light}
      />
    );
    const card = UNSAFE_getByType(Animated.View);
    const style = StyleSheet.flatten(card.props.style);
    const translation = style.transform?.[0]
      ?.translateY as InspectableAnimatedValue;
    expect(style.opacity).toBe(1);
    expect(translation.__getValue()).toBe(0);

    await act(async () => {
      resolvePreference(false);
      await Promise.resolve();
    });

    expect(transitions).toEqual([{ from: 4, to: 0 }]);
    expect(translation.__getValue()).toBe(0);
    expect(StyleSheet.flatten(card.props.style).opacity).toBe(1);
  });
});
