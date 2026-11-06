import { renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useSavingsCelebration } from './use-savings-celebration';

type Props = {
  amount: number;
  adding: boolean;
  visible?: boolean;
  goalId?: string;
};

function setup(initial: Props) {
  return renderHook(
    ({ amount, adding, visible = true, goalId = 'goal-1' }: Props) =>
      useSavingsCelebration({
        currentAmount: amount,
        goalId,
        isAdding: adding,
        targetAmount: 10000,
        visible,
      }),
    { initialProps: initial }
  );
}

describe('useSavingsCelebration', () => {
  const originalOs = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    jest.mocked(Haptics.notificationAsync).mockClear();
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOs });
  });

  it('celebrates once the saved amount grew after adding finished, with a success haptic', () => {
    const { result, rerender } = setup({ amount: 2000, adding: false });
    expect(result.current).toBeNull();
    rerender({ amount: 2000, adding: true });
    rerender({ amount: 4200, adding: true });
    expect(result.current).toBeNull();
    rerender({ amount: 4200, adding: false });
    expect(result.current).toEqual({ added: 2200, percent: 42 });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('stays quiet when adding ended without the amount growing', () => {
    const { result, rerender } = setup({ amount: 2000, adding: false });
    rerender({ amount: 2000, adding: true });
    rerender({ amount: 2000, adding: false });
    expect(result.current).toBeNull();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('keeps exact whole-number celebration percentages', () => {
    const { result, rerender } = setup({ amount: 0, adding: false });
    rerender({ amount: 0, adding: true });
    rerender({ amount: 5800, adding: true });
    rerender({ amount: 5800, adding: false });
    expect(result.current).toEqual({ added: 5800, percent: 58 });
  });

  it('clears the celebration when the next add starts or the sheet closes', () => {
    const { result, rerender } = setup({ amount: 0, adding: false });
    rerender({ amount: 0, adding: true });
    rerender({ amount: 1000, adding: false });
    expect(result.current).not.toBeNull();
    rerender({ amount: 1000, adding: true });
    expect(result.current).toBeNull();
    rerender({ amount: 2000, adding: false });
    expect(result.current).not.toBeNull();
    rerender({ amount: 2000, adding: false, visible: false });
    expect(result.current).toBeNull();
  });
});

it('does not attribute another goal balance to the previous contribution', () => {
  const { result, rerender } = setup({ amount: 2000, adding: true });
  rerender({ amount: 9000, adding: false, goalId: 'goal-2' });
  expect(result.current).toBeNull();
});
