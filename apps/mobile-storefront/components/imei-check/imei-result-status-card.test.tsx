import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { getVerdictColors } from './get-verdict-colors';
import { ImeiResultStatusCard } from './imei-result-status-card';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

describe('IMEI result status card', () => {
  it.each([
    ['Clean', 'safe'],
    ['Blacklisted', 'danger'],
  ])('uses the %s evidence palette', (value, verdict) => {
    render(
      <ImeiResultStatusCard
        colors={Colors.light}
        icon="shield-outline"
        label="Blacklist"
        value={value}
        cleanAware
      />
    );
    expect(screen.getByText(value)).toHaveStyle({
      color: getVerdictColors(verdict, Colors.light).text,
    });
  });
  it('uses the explicit tint for ordinary statuses', () => {
    render(
      <ImeiResultStatusCard
        colors={Colors.light}
        icon="shield-outline"
        label="Carrier"
        value="Unlocked"
        tint="#123456"
      />
    );
    expect(screen.getByText('Unlocked')).toHaveStyle({ color: '#123456' });
  });
  it('defaults ordinary statuses to the theme text color', () => {
    render(
      <ImeiResultStatusCard
        colors={Colors.light}
        icon="shield-outline"
        label="Carrier"
        value="Unknown"
      />
    );
    expect(screen.getByText('Unknown')).toHaveStyle({
      color: Colors.light.text,
    });
  });
});
