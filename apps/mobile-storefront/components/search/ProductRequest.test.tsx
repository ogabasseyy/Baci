import {
  ProductRequestSubmitError,
  submitProductRequest,
} from '@baci/shared/lib';
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
  submitProductRequest: jest.fn(),
}));
const mockRandomUUID = jest.fn(() => '11111111-1111-4111-8111-111111111111');
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));
beforeEach(() => {
  jest.mocked(submitProductRequest).mockReset();
});
it('prefills the searched product and sends only after explicit submission', async () => {
  jest.mocked(submitProductRequest).mockResolvedValue();
  render(<ProductRequest query="iPhone 20" colors={Colors.light} />);
  fireEvent.press(screen.getByRole('button', { name: 'Request this product' }));
  expect(screen.getByDisplayValue('iPhone 20')).toBeTruthy();
  expect(submitProductRequest).not.toHaveBeenCalled();
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
  expect(submitProductRequest).toHaveBeenCalledWith(
    expect.stringContaining('/api/storefront/product-requests'),
    expect.objectContaining({
      query: 'iPhone 20',
      contact: 'shopper@example.com',
      merchantSlug: 'ogabassey',
    })
  );
});
it('retains the form and request identity after a failed submission', async () => {
  jest.mocked(submitProductRequest).mockRejectedValue(new Error('offline'));
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
  await waitFor(() => expect(submitProductRequest).toHaveBeenCalledTimes(2));
  expect(jest.mocked(submitProductRequest).mock.calls[0][1].requestId).toBe(
    jest.mocked(submitProductRequest).mock.calls[1][1].requestId
  );
});
it('surfaces an error and stays submittable when id generation throws', async () => {
  mockRandomUUID.mockImplementationOnce(() => {
    throw new Error('no crypto');
  });
  jest.mocked(submitProductRequest).mockResolvedValue();
  render(<ProductRequest query="iPhone 20" colors={Colors.light} />);
  fireEvent.press(screen.getByRole('button', { name: 'Request this product' }));
  fireEvent.changeText(
    screen.getByLabelText('Email or phone number'),
    'shopper@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send product request' }));
  await waitFor(() => expect(screen.getByText(/Couldn’t send/)).toBeTruthy());
  // The failed attempt releases the send guard, so a retry submits.
  fireEvent.press(screen.getByRole('button', { name: 'Send product request' }));
  await waitFor(() => expect(submitProductRequest).toHaveBeenCalledTimes(1));
});
it('shows a retry signal instead of a validation error on idempotency conflict', async () => {
  jest
    .mocked(submitProductRequest)
    .mockRejectedValue(new ProductRequestSubmitError(409, 'conflict'));
  render(<ProductRequest query="iPhone 20" colors={Colors.light} />);
  fireEvent.press(screen.getByRole('button', { name: 'Request this product' }));
  fireEvent.changeText(
    screen.getByLabelText('Email or phone number'),
    'shopper@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Send product request' }));
  await waitFor(() =>
    expect(screen.getByText(/conflicts with an earlier one/)).toBeTruthy()
  );
});
