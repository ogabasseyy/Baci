import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { getVerdictColors } from './get-verdict-colors';
import { ImeiResultVerdictBanner } from './imei-result-verdict-banner';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

describe('ImeiResultVerdictBanner', () => {
  it.each<['safe' | 'caution' | 'danger', string]>([
    ['safe', 'Looks safe to buy'],
    ['caution', 'Check before you buy'],
    ['danger', 'Do not buy yet'],
  ])('shows the %s headline in its verdict colour', (type, headline) => {
    render(
      <ImeiResultVerdictBanner
        colors={Colors.light}
        score={82}
        text="Report text"
        type={type}
      />
    );
    expect(screen.getByRole('header', { name: headline })).toHaveStyle({
      color: getVerdictColors(type, Colors.light).text,
    });
    expect(screen.getByText('Report text')).toBeOnTheScreen();
  });

  it('labels the trust score for screen readers', () => {
    render(
      <ImeiResultVerdictBanner
        colors={Colors.light}
        score={64}
        text="Report text"
        type="caution"
      />
    );
    expect(screen.getByLabelText('Trust score 64%')).toBeOnTheScreen();
    expect(screen.getByText('64%')).toBeOnTheScreen();
  });
});
