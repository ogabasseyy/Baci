import Colors, { BRAND } from '@/constants/Colors';
import { withSavingsBrand } from './savings-sheet-colors';

// Pure colours: no server call, so it is the same with PiggyVest on or off.
describe('withSavingsBrand', () => {
  it('uses the red brand accent in both themes and keeps the rest', () => {
    for (const theme of [Colors.light, Colors.dark]) {
      const colors = withSavingsBrand(theme);
      expect(colors.primary).toBe(BRAND.primary);
      expect(colors.primaryForeground).toBe(BRAND.onPrimary);
      expect(colors.primaryLowOpacity).toBe(BRAND.primaryAlpha12);
      expect(colors.background).toBe(theme.background);
    }
  });
});
