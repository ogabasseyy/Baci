import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import AppKeyboardProvider from './AppKeyboardProvider';

describe('AppKeyboardProvider', () => {
  it('renders children inside an edge-to-edge keyboard provider', () => {
    render(
      <AppKeyboardProvider>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );

    const provider = screen.getByTestId('keyboard-provider');

    expect(screen.getByText('Storefront app')).toBeTruthy();
    expect(provider).toHaveProp('preload', false);
    expect(provider).toHaveProp('navigationBarTranslucent', true);
    expect(provider).toHaveProp('preserveEdgeToEdge', true);
    expect(provider).toHaveProp('statusBarTranslucent', true);
  });
});
