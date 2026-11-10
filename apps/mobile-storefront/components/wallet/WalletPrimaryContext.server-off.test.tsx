import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  useWalletPrimaryReady,
  WalletPrimaryContext,
} from './WalletPrimaryContext';

function Probe() {
  return <Text>{useWalletPrimaryReady() ? 'primary' : 'legacy'}</Text>;
}

describe('WalletPrimaryContext with the server off', () => {
  it('reads legacy outside any provider, so server-off screens are unchanged', () => {
    render(<Probe />);
    expect(screen.getByText('legacy')).toBeOnTheScreen();
  });

  it('reads legacy when the provider carries a false verdict', () => {
    render(
      <WalletPrimaryContext.Provider value={false}>
        <Probe />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.getByText('legacy')).toBeOnTheScreen();
  });

  it('reads primary only on an explicit ready verdict', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <Probe />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.getByText('primary')).toBeOnTheScreen();
  });
});
