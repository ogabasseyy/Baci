import { act, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';
import { OxygenHostedModal } from './OxygenHostedModal';

jest.mock('./OxygenHostedSurface', () => ({
  OxygenHostedSurface: () => {
    const { Text } = require('react-native');
    return <Text>Provider camera page</Text>;
  },
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

it.each([
  'selfie',
  'payment',
] as const)('opens %s in a full-screen native surface with a working system back action', (kind) => {
  const onExit = jest.fn();
  const handlesForeground = { current: false };
  const rendered = render(
    <OxygenHostedModal
      url="https://provider.example/flow"
      kind={kind}
      capabilities={{
        hostedOrigins: ['https://provider.example'],
        selfieOrigins: ['https://provider.example'],
      }}
      active
      handlesForeground={handlesForeground}
      onRefresh={jest.fn()}
      onExit={onExit}
    />
  );
  const modal = screen.UNSAFE_getByType(Modal);
  expect(modal.props.presentationStyle).toBe('fullScreen');
  expect(modal.props.visible).toBe(true);
  expect(handlesForeground.current).toBe(true);
  expect(screen.getByText('Provider camera page')).toBeTruthy();
  act(() => modal.props.onRequestClose());
  expect(onExit).toHaveBeenCalledTimes(1);
  rendered.unmount();
  expect(handlesForeground.current).toBe(false);
});
