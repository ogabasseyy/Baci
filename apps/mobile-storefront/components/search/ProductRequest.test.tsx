import { sendProductRequest } from '@baci/shared/lib';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import ProductRequest from './ProductRequest';

jest.mock('@baci/shared/lib', () => ({
  ...jest.requireActual('@baci/shared/lib'),
  sendProductRequest: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
}));
beforeEach(() => {
  jest.mocked(sendProductRequest).mockReset();
});
it('prefills the searched product and sends only after explicit submission', async () => {
  jest.mocked(sendProductRequest).mockResolvedValue();
  render(<ProductRequest query="iPhone 20" colors={Colors.light} />);
  fireEvent.press(screen.getByRole('button', { name: 'Request this product' }));
  expect(screen.getByDisplayValue('iPhone 20')).toBeTruthy();
  expect(sendProductRequest).not.toHaveBeenCalled();
  fireEvent.changeText(
    screen.getByLabelText('Email or phone number'),
    'shopper@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send product request' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        'Request sent to the store. They may contact you if they can source it.'
      )
    ).toBeTruthy()
  );
  expect(sendProductRequest).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      query: 'iPhone 20',
      contact: 'shopper@example.com',
      merchantSlug: 'ogabassey',
    })
  );
});
it('retains the form and request identity after a failed submission', async () => {
  jest.mocked(sendProductRequest).mockRejectedValue(new Error('offline'));
  render(<ProductRequest query="iPhone 20" colors={Colors.light} />);
  fireEvent.press(screen.getByRole('button', { name: 'Request this product' }));
  fireEvent.changeText(
    screen.getByLabelText('Email or phone number'),
    'shopper@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send product request' }));
  await waitFor(() => expect(screen.getByText(/Couldn’t send/)).toBeTruthy());
  expect(screen.queryByText(/Request sent to the store/)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Send product request' }));
  await waitFor(() => expect(sendProductRequest).toHaveBeenCalledTimes(2));
  expect(jest.mocked(sendProductRequest).mock.calls[0][1].requestId).toBe(
    jest.mocked(sendProductRequest).mock.calls[1][1].requestId
  );
});
