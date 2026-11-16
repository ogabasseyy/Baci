import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import HeroCard from './imei-check-hero-card';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

describe('HeroCard', () => {
  it('renders the heading and trust indicators without a redundant title', () => {
    render(<HeroCard />);

    expect(screen.getByText('Device verification')).toBeTruthy();
    expect(screen.queryByText('IMEI Checker')).toBeNull();
    expect(screen.getByText('15-digit check')).toBeTruthy();
    expect(screen.getByText('Official status')).toBeTruthy();
    expect(screen.getByText('Instant report')).toBeTruthy();
  });
});
