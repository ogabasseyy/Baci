import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiResultStatusList } from './imei-result-status-list';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

describe('ImeiResultStatusList', () => {
  it('shows each finding, coloured by what it means', () => {
    render(
      <ImeiResultStatusList
        colors={Colors.light}
        cards={[
          {
            label: 'Blacklist',
            value: 'Clean',
            icon: 'shield-checkmark-outline',
            blacklist: true,
            cleanAware: true,
          },
          {
            label: 'Warranty',
            value: 'Out Of Warranty',
            icon: 'calendar-outline',
          },
        ]}
      />
    );

    expect(screen.getByText('Clean')).toBeTruthy();
    expect(screen.getByText('Out Of Warranty')).toBeTruthy();
    expect(screen.getByTestId('imei-status-safe')).toBeTruthy();
    expect(screen.getByTestId('imei-status-neutral')).toBeTruthy();
  });

  it('renders nothing when there are no findings', () => {
    render(<ImeiResultStatusList colors={Colors.light} cards={[]} />);
    expect(screen.queryByTestId(/imei-status-/)).toBeNull();
  });
});
