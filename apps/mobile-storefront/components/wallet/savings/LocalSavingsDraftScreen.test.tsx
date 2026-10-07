import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { SavingsDraft } from '@/schemas/customer-savings-drafts';
import { draftFixture } from '@/schemas/customer-savings-drafts.test-fixture';
import { LocalSavingsDraftScreen } from './LocalSavingsDraftScreen';

const mockLegacyController = jest.fn(() => {
  throw new Error('Legacy money controller must not mount');
});
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => mockLegacyController(),
}));

const mockUser = {
  user: { id: 'customer' } as { id: string } | null,
  merchantId: 'merchant',
};
const mockList = jest.fn<() => Promise<SavingsDraft[]>>();
const mockCreate = jest.fn<(...args: unknown[]) => Promise<SavingsDraft>>();
const mockRead = jest.fn<() => Promise<SavingsDraft>>();
const mockAccept = jest.fn<(...args: unknown[]) => Promise<SavingsDraft>>();
const mockProductLookup = jest.fn<(id: string) => unknown>();
const mockRequestId = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockParams: { productId?: string; variantId?: string } = {};
const mockProduct = {
  id: draftFixture.productId,
  name: 'Synthetic phone',
  slug: 'synthetic-phone',
  condition: 'new',
  price: 250000,
  image: '',
  has_variants: true,
  variants: [
    {
      id: draftFixture.variantId,
      name: '256GB Black',
      condition: 'new',
      price: 250000,
      stock_quantity: 5,
      attributes: { storage: '256GB', color: 'Black' },
    },
    {
      id: '10000000-0000-4000-8000-000000000005',
      name: '512GB Blue',
      condition: 'new',
      price: 320000,
      stock_quantity: 5,
      attributes: { storage: '512GB', color: 'Blue' },
    },
  ],
};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof mockUser) => unknown) =>
    selector(mockUser),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({
    products: [mockProduct],
    isLoading: false,
    isError: false,
    hasMore: false,
  }),
}));
jest.mock('@/hooks/use-product', () => ({
  useProduct: (id: string) => mockProductLookup(id),
}));
jest.mock('@/lib/customer-savings-drafts', () => ({
  customerSavingsDrafts: {
    list: () => mockList(),
    create: (...args: unknown[]) => mockCreate(...args),
    read: () => mockRead(),
    accept: (...args: unknown[]) => mockAccept(...args),
  },
}));
jest.mock('@/lib/savings-draft-request-id', () => ({
  savingsDraftRequestId: (...args: unknown[]) => mockRequestId(...args),
}));
const previous = process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
it('keeps staging device search above the keyboard with room for results', async () => {
  render(<LocalSavingsDraftScreen />);
  await waitFor(() => expect(mockList).toHaveBeenCalled());
  fireEvent(screen.getByLabelText('Savings product search'), 'focus');
  expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
    'bottomOffset',
    200
  );
  expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
    'keyboardShouldPersistTaps',
    'handled'
  );
  fireEvent(screen.getByLabelText('Savings product search'), 'blur');
  expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
    'bottomOffset',
    24
  );
});

beforeEach(() => {
  mockRequestId.mockReset().mockResolvedValue(draftFixture.requestId);
  process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = '1';
  mockUser.user = { id: 'customer' };
  delete mockParams.productId;
  delete mockParams.variantId;
  mockList.mockReset().mockResolvedValue([]);
  mockCreate.mockReset().mockResolvedValue(draftFixture);
  mockRead.mockReset().mockResolvedValue(draftFixture);
  mockAccept.mockReset().mockResolvedValue({
    ...draftFixture,
    consent: 'accepted',
    acceptedAt: '2026-09-13T07:01:00Z',
  });
  mockProductLookup.mockReset().mockImplementation((id) => ({
    product: id ? mockProduct : undefined,
    isLoading: false,
  }));
});
afterEach(() => {
  if (previous === undefined) delete process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
  else process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = previous;
});

it('distinguishes saved drafts for the same device by consent status', async () => {
  mockList.mockResolvedValue([
    draftFixture,
    {
      ...draftFixture,
      draftId: '10000000-0000-4000-8000-000000000099',
      consent: 'accepted',
      acceptedAt: '2026-09-13T07:01:00Z',
    },
  ]);
  render(<LocalSavingsDraftScreen />);
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  fireEvent.press(
    screen.getByRole('button', { name: 'View saved drafts (2)' })
  );
  expect(screen.getByText('Terms accepted')).toBeOnTheScreen();
  expect(screen.getByText('Review terms required')).toBeOnTheScreen();
});

it('keeps the isolated draft harness free of unsupported financial choices', async () => {
  render(<LocalSavingsDraftScreen />);
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  expect(screen.getByText('Dream it.\nSave for it.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Savings product search')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Savings target amount')).toBeNull();
  expect(screen.queryByLabelText('Savings contribution amount')).toBeNull();
  expect(screen.queryByLabelText('Savings start date')).toBeNull();
  expect(screen.queryByLabelText('Savings debit time')).toBeNull();
  expect(screen.queryByLabelText('Use auto debit for savings')).toBeNull();
  expect(
    screen.queryByLabelText('Accept non-withdrawable savings terms')
  ).toBeNull();
  expect(
    screen.getByText(
      'Only your device choice is saved. Schedule, funding and interest are not available in this test.'
    )
  ).toBeOnTheScreen();
  expect(mockLegacyController).not.toHaveBeenCalled();
});

it('requires the exact variant, then saves draft consent without exposing money actions', async () => {
  render(<LocalSavingsDraftScreen />);
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  fireEvent.changeText(
    screen.getByLabelText('Savings product search'),
    'phone'
  );
  expect(
    screen.queryByRole('button', { name: 'Review savings draft' })
  ).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Select Synthetic phone' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: /Select Synthetic phone.*256GB/ })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Review savings draft' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm draft terms' })
    ).toBeDisabled()
  );
  expect(mockCreate).toHaveBeenCalledWith(
    { userId: 'customer', merchantId: 'merchant' },
    {
      productId: draftFixture.productId,
      variantId: draftFixture.variantId,
      requestId: draftFixture.requestId,
    }
  );
  fireEvent.press(
    screen.getByRole('checkbox', {
      name: 'I have reviewed and accept these draft terms',
    })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Confirm draft terms' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        'Your draft and consent are saved. Funding and interest are not activated.'
      )
    ).toBeTruthy()
  );
  expect(
    screen.queryByRole('button', { name: /fund|pay|contribute/i })
  ).toBeNull();
});

it('loads route-selected products directly rather than assuming the first catalogue page contains them', async () => {
  mockParams.productId = draftFixture.productId;
  mockParams.variantId = draftFixture.variantId;
  render(<LocalSavingsDraftScreen />);
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  expect(mockProductLookup).toHaveBeenCalledWith(draftFixture.productId);
  expect(
    screen.getByRole('button', { name: /256GB/, selected: true })
  ).toBeTruthy();
});

it('does not show an old customer draft after logout while a response is pending', async () => {
  let resolveList: (drafts: SavingsDraft[]) => void = () => undefined;
  mockList.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveList = resolve;
      })
  );
  const rendered = render(<LocalSavingsDraftScreen />);
  mockUser.user = null;
  rendered.rerender(<LocalSavingsDraftScreen />);
  await act(async () => resolveList([draftFixture]));
  expect(screen.getByText('Please sign in to start saving.')).toBeTruthy();
  expect(screen.queryByText('Your saved drafts')).toBeNull();
});
it('offers explicit replacement only after stale acceptance and requires fresh consent', async () => {
  mockParams.productId = draftFixture.productId;
  mockParams.variantId = draftFixture.variantId;
  render(<LocalSavingsDraftScreen />);
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  fireEvent.press(screen.getByRole('button', { name: 'Review savings draft' }));
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());
  expect(screen.getByText(/Saved catalogue price:/)).toBeTruthy();
  expect(screen.getByText('Not a price guarantee or activation.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start new draft' })).toBeNull();
  mockAccept.mockRejectedValue(
    Object.assign(new Error('stale'), {
      code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
      status: 409,
    })
  );
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Confirm draft terms' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start new draft' })).toBeTruthy()
  );
  const replacement = {
    ...draftFixture,
    requestId: '30000000-0000-4000-8000-000000000003',
    revisionId: '30000000-0000-4000-8000-000000000004',
  };
  mockRequestId.mockResolvedValue(replacement.requestId);
  mockCreate.mockResolvedValue(replacement);
  fireEvent.press(screen.getByRole('button', { name: 'Start new draft' }));
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  expect(
    screen.getByRole('button', { name: 'Confirm draft terms' })
  ).toBeDisabled();
  expect(mockRequestId).toHaveBeenLastCalledWith(
    expect.anything(),
    draftFixture.requestId
  );
});
