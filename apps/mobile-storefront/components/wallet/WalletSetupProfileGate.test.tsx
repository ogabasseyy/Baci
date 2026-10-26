import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletSetupProfileGate } from './WalletSetupProfileGate';

const mockUpdate = jest.fn();
let mockCustomer: {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
} = { id: 'customer', first_name: '', last_name: '', phone: '08012345678' };
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: mockCustomer,
      merchantId: 'merchant',
      updateProfile: mockUpdate,
    }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCustomer = {
    id: 'customer',
    first_name: '',
    last_name: '',
    phone: '08012345678',
  };
});

it('requires missing names before mounting the sensitive BVN step', async () => {
  mockUpdate.mockResolvedValue({ success: true });
  const { rerender } = render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );
  expect(screen.queryByText('BVN step')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('First name'), 'Ada');
  fireEvent.changeText(screen.getByLabelText('Last name'), 'Okafor');
  fireEvent.press(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({
      first_name: 'Ada',
      last_name: 'Okafor',
    })
  );
  mockCustomer = {
    id: 'customer',
    first_name: 'Ada',
    last_name: 'Okafor',
    phone: '08012345678',
  };
  rerender(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );
  expect(screen.getByText('BVN step')).toBeOnTheScreen();
  expect(screen.queryByLabelText('First name')).toBeNull();
});

it('automatically reuses complete saved names without an extra step', () => {
  mockCustomer = {
    id: 'customer',
    first_name: 'Ada',
    last_name: 'Okafor',
    phone: '08012345678',
  };
  render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );
  expect(screen.getByText('BVN step')).toBeOnTheScreen();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it.each([
  null,
  '',
  '   ',
])('collects a missing phone (%s) after saved names and before BVN', (phone) => {
  mockCustomer = {
    id: 'customer',
    first_name: 'Sandbox',
    last_name: 'FreshQA',
    phone,
  };
  render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );

  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
  expect(screen.queryByLabelText('First name')).toBeNull();
  expect(screen.queryByText('BVN step')).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('saves only the phone through updateProfile and waits for the updated profile before BVN', async () => {
  mockCustomer = {
    id: 'customer',
    first_name: 'Sandbox',
    last_name: 'FreshQA',
    phone: null,
  };
  mockUpdate.mockResolvedValue({ success: true });
  const { rerender } = render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );

  fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
  fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({ phone: '08012345678' })
  );
  expect(screen.queryByText('BVN step')).toBeNull();
  mockCustomer = { ...mockCustomer, phone: '08012345678' };
  rerender(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );
  expect(screen.getByText('BVN step')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Phone number')).toBeNull();
});

it('keeps BVN blocked when saving the phone fails', async () => {
  mockCustomer = {
    id: 'customer',
    first_name: 'Sandbox',
    last_name: 'FreshQA',
    phone: null,
  };
  mockUpdate.mockResolvedValue({
    success: false,
    error: 'Could not save your phone number.',
  });
  render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );

  fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
  fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

  await waitFor(() =>
    expect(
      screen.getByText('Could not save your phone number.')
    ).toBeOnTheScreen()
  );
  expect(screen.queryByText('BVN step')).toBeNull();
});

it('keeps BVN blocked if saving names fails', async () => {
  mockUpdate.mockResolvedValue({ success: false });
  render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );
  fireEvent.changeText(screen.getByLabelText('First name'), 'Ada');
  fireEvent.changeText(screen.getByLabelText('Last name'), 'Okafor');
  fireEvent.press(screen.getByRole('button', { name: 'Save and continue' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
  expect(screen.queryByText('BVN step')).toBeNull();
});

it('collects names before phone when both are missing', () => {
  mockCustomer.phone = null;
  render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );

  expect(screen.getByLabelText('First name')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Phone number')).toBeNull();
  expect(screen.queryByText('BVN step')).toBeNull();
});

it('waits for the matching merchant profile before collecting phone', () => {
  mockCustomer = {
    id: 'customer',
    first_name: 'Sandbox',
    last_name: 'FreshQA',
    phone: null,
  };
  render(
    <WalletSetupProfileGate colors={Colors.dark} merchantId="another-merchant">
      <Text>BVN step</Text>
    </WalletSetupProfileGate>
  );

  expect(screen.getByText('Loading your profile…')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Phone number')).toBeNull();
  expect(screen.queryByText('BVN step')).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
});
