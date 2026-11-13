import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getCheckoutIdentityTheme } from '../colors';
import { SecurityFooter } from './SecurityFooter';

it('announces secure checkout and respects the bottom safe-area inset', () => {
  const theme = getCheckoutIdentityTheme('dark');
  render(<SecurityFooter bottomInset={24} theme={theme} />);

  const footer = screen.getByLabelText('Secure checkout');
  expect(footer).toBeTruthy();
  expect(screen.getByText('Secure checkout')).toBeTruthy();
  expect(StyleSheet.flatten(footer.props.style)).toMatchObject({
    backgroundColor: theme.sheet,
    borderTopColor: theme.border,
    paddingBottom: 24,
  });
});
