import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { renderCartShell } from './CartScreenShell';

it('reserves both side insets and lets cart content handle vertical insets', () => {
  render(renderCartShell(<Text>Cart controls</Text>));

  expect(screen.getByTestId('storefront-cart-safe-area').props.edges).toEqual({
    bottom: 'off',
    left: 'additive',
    right: 'additive',
    top: 'off',
  });
  expect(screen.getByText('Cart controls')).toBeVisible();
});
