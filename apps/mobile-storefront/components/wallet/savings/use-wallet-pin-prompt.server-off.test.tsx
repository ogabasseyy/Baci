import { renderHook } from '@testing-library/react-native';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';

// Nothing asks for a PIN unless a contribution is refused for want of one,
// which a server with PiggyVest off never does.
describe('server keeps PiggyVest off', () => {
  it('starts with no request, so no sheet opens', () => {
    const { result } = renderHook(() => useWalletPinPrompt());
    expect(result.current.sheetProps.request).toBeNull();
  });
});
