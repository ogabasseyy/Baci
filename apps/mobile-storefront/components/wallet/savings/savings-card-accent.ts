import Colors from '@/constants/Colors';
import type { StartSavingsColors } from './start-savings.types';

export function savingsCardAccent(colors: StartSavingsColors) {
  const dark = colors.background === Colors.dark.background;
  return {
    backgroundColor: dark ? '#241F30' : '#F7F2FF',
    borderColor: dark ? '#65517F' : '#D8C5F2',
  };
}
