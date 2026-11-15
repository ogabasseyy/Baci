import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConnectivityBanner } from './ConnectivityBanner';

type Listener = (state: { isConnected: boolean | null }) => void;
let mockListener: Listener = () => undefined;
let mockInitial: { isConnected: boolean | null } = { isConnected: true };

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: Listener) => {
      mockListener = listener;
      return () => undefined;
    },
    fetch: () => Promise.resolve(mockInitial),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

describe('bugfix: the offline banner covered screen headers', () => {
  it('takes no space while online', async () => {
    mockInitial = { isConnected: true };
    render(<ConnectivityBanner />);
    await act(async () => undefined);
    expect(
      screen.queryByText("You're offline. Browse what you've seen!")
    ).toBeNull();
  });

  it('sits in the layout (not on top of the screen) while offline', async () => {
    mockInitial = { isConnected: true };
    render(<ConnectivityBanner />);
    await act(async () => undefined);
    act(() => mockListener({ isConnected: false }));
    const text = screen.getByText("You're offline. Browse what you've seen!");
    let node = text.parent;
    while (node?.parent && !StyleSheet.flatten(node.props.style)?.paddingTop)
      node = node.parent;
    const style = StyleSheet.flatten(node?.props.style) ?? {};
    expect(style.position).not.toBe('absolute');
    expect(style.paddingTop).toBe(47 + 8);
  });
});
