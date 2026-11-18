import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiCheckTierRow } from './imei-check-tier-row';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

const renderRow = (isSelected: boolean) => {
  const onPress = jest.fn();
  const onShowDetails = jest.fn();
  render(
    <ImeiCheckTierRow
      colors={Colors.light}
      divider={false}
      isSelected={isSelected}
      tier={IMEI_SERVICE_TIERS.blacklist}
      onPress={onPress}
      onShowDetails={onShowDetails}
    />
  );
  return { onPress, onShowDetails };
};

describe('ImeiCheckTierRow', () => {
  it('names the check and its price and selects on press', () => {
    const { onPress, onShowDetails } = renderRow(false);
    const row = screen.getByRole('radio', { name: 'Stolen Check, ₦700' });
    expect(row).toHaveAccessibilityState({ selected: false });
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onShowDetails).not.toHaveBeenCalled();
  });

  it('opens the details from the info button without selecting', () => {
    const { onPress, onShowDetails } = renderRow(true);
    expect(screen.getByRole('radio')).toHaveAccessibilityState({
      selected: true,
    });
    fireEvent.press(screen.getByLabelText('What Stolen Check includes'));
    expect(onShowDetails).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('marks the recommended check as best value', () => {
    render(
      <ImeiCheckTierRow
        colors={Colors.light}
        divider
        isSelected={false}
        tier={IMEI_SERVICE_TIERS.full}
        onPress={jest.fn()}
        onShowDetails={jest.fn()}
      />
    );
    expect(screen.getByText('Best value')).toBeOnTheScreen();
  });

  it('keeps the info button outside the selectable area (Muse)', () => {
    renderRow(false);
    const row = screen.getByRole('radio', { name: 'Stolen Check, ₦700' });
    const info = screen.getByLabelText('What Stolen Check includes');
    expect(row).not.toContainElement(info);
  });
});
