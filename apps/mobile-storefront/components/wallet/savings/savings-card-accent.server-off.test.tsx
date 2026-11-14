import Colors, { palette } from '@/constants/Colors';
import { savingsCardAccent } from './savings-card-accent';

describe('savingsCardAccent with PiggyVest off', () => {
  it('uses the brand red tint in light mode', () => {
    expect(savingsCardAccent(Colors.light)).toEqual({
      backgroundColor: palette.red[50],
      borderColor: palette.red[200],
    });
  });

  it('uses a dark red tint in dark mode', () => {
    expect(savingsCardAccent(Colors.dark).borderColor).toBe(palette.red[900]);
  });
});
