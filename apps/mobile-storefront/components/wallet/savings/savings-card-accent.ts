import Colors, { palette } from '@/constants/Colors';
import type { StartSavingsColors } from './start-savings.types';

export function savingsCardAccent(colors: StartSavingsColors) {
  const dark = colors.background === Colors.dark.background;
  return {
    // Brand red tints, so the savings steps match the rest of the store.
    backgroundColor: dark ? '#2A1416' : palette.red[50],
    borderColor: dark ? palette.red[900] : palette.red[200],
  };
}
