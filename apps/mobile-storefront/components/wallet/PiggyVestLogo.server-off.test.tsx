import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { Path } from 'react-native-svg';
import { PiggyVestLogo } from './PiggyVestLogo';
import { SavingsProviderPreview } from './SavingsProviderPreview';

it('keeps the default logo color and hides provider attribution on the production preview surface', () => {
  const originalDev = globalThis.__DEV__;
  globalThis.__DEV__ = false;
  try {
    const { rerender } = render(<PiggyVestLogo />, { wrapper: View });
    expect(screen.UNSAFE_getAllByType(Path)[0]?.props.fill).toBe('#0C1825');

    rerender(<SavingsProviderPreview subtle />);
    expect(screen.queryByLabelText(/powered by piggyvest/i)).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Path)).toHaveLength(0);
  } finally {
    globalThis.__DEV__ = originalDev;
  }
});
