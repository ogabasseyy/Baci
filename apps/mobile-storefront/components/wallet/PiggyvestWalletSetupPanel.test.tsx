import BottomSheet from '@gorhom/bottom-sheet';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

jest.mock('@gorhom/bottom-sheet', () =>
  require('./wallet-bottom-sheet.test-utils')
);

let mockPhone: string | null = '08012345678';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: {
        id: 'customer',
        first_name: 'Sandbox',
        last_name: 'FreshQA',
        phone: mockPhone,
      },
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      updateProfile: jest.fn(),
    }),
}));

const setup = (state: ReturnType<typeof usePiggyvestWalletSetup>['state']) => ({
  scopeKey: 'merchant:user',
  account: null,
  state,
  recoverable: false,
  reviewRequired: false,
  justCreated: false,
  acknowledgeReady: jest.fn(),
  hasCheckError: false,
  isChecking: false,
  delayed: false,
  submitting: false,
  refresh: jest.fn(),
  submit: jest.fn(async () => undefined),
  recover: jest.fn(async () => undefined),
});
const props = {
  colors: Colors.dark,
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  needsPhone: false,
  onSubmitPhone: jest.fn(async () => ({ success: true })),
  onClose: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  mockPhone = '08012345678';
});

it('collects the saved-profile missing phone even when the primary setup caller supplies stale needsPhone=false', () => {
  mockPhone = null;
  const notStarted = setup('not_started');
  render(
    <PiggyvestWalletSetupPanel
      {...props}
      needsPhone={false}
      setup={notStarted}
    />
  );

  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.queryByLabelText('First name')).toBeNull();
  expect(notStarted.submit).not.toHaveBeenCalled();
});

it('does not allow account creation before the authoritative initial check settles', () => {
  mockPhone = null;
  render(<PiggyvestWalletSetupPanel {...props} setup={setup('checking')} />);
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.queryByLabelText('Phone number')).toBeNull();
});
it('shows account creation only after setup is confirmed not started', () => {
  render(<PiggyvestWalletSetupPanel {...props} setup={setup('not_started')} />);
  expect(screen.getByLabelText('BVN')).toBeOnTheScreen();
  expect(screen.queryByTestId('bottom-sheet-text-input')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeOnTheScreen();
});
it('uses the sheet-aware BVN input when its caller confirms sheet ownership', () => {
  render(
    <BottomSheet>
      <PiggyvestWalletSetupPanel
        {...props}
        insideBottomSheet
        setup={setup('not_started')}
      />
    </BottomSheet>
  );
  expect(screen.getByTestId('bottom-sheet-text-input')).toBeOnTheScreen();
});
it('lets a processing customer leave and retry without creating another account', () => {
  mockPhone = null;
  const pending = { ...setup('processing'), delayed: true };
  render(<PiggyvestWalletSetupPanel {...props} setup={pending} />);
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.queryByLabelText('Phone number')).toBeNull();
  expect(
    screen.getByText(
      'We’re still checking your account. If setup does not finish, contact support so we can verify your wallet.'
    )
  ).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh PiggyVest account' })
  );
  expect(pending.refresh).toHaveBeenCalledTimes(1);
  expect(pending.submit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
it('shows BVN re-entry only after GET marks the pending setup recoverable', () => {
  const recoverable = { ...setup('processing'), recoverable: true };
  render(<PiggyvestWalletSetupPanel {...props} setup={recoverable} />);

  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(
    screen.getByRole('button', {
      name: 'Re-enter BVN to recover wallet setup',
    })
  ).toBeOnTheScreen();
  expect(recoverable.submit).not.toHaveBeenCalled();

  fireEvent.press(
    screen.getByRole('button', {
      name: 'Re-enter BVN to recover wallet setup',
    })
  );
  expect(screen.getByLabelText('BVN')).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeOnTheScreen();
  expect(recoverable.submit).not.toHaveBeenCalled();
});
it('never offers BVN re-entry while the setup needs review', () => {
  render(
    <PiggyvestWalletSetupPanel
      {...props}
      setup={{
        ...setup('unavailable'),
        recoverable: true,
        reviewRequired: true,
      }}
    />
  );

  expect(screen.getByRole('alert')).toHaveTextContent(
    /Your PiggyVest wallet setup needs review\./
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Re-enter BVN to recover wallet setup',
    })
  ).toBeNull();
});
it('keeps unavailable status distinct from a nonexistent account and permits retry', () => {
  const failed = { ...setup('unavailable'), hasCheckError: true };
  render(<PiggyvestWalletSetupPanel {...props} setup={failed} />);
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(
    screen.getByText(
      'We could not check your account. Try again, or contact support if this continues.'
    )
  ).toBeOnTheScreen();
  expect(screen.queryByText(/We’re still checking your account/)).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh PiggyVest account' })
  );
  expect(failed.refresh).toHaveBeenCalledTimes(1);
});
it('collects the missing phone before permitting BVN submission', () => {
  render(
    <PiggyvestWalletSetupPanel
      {...props}
      needsPhone
      setup={setup('not_started')}
    />
  );
  expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
  expect(screen.queryByLabelText('BVN')).toBeNull();
});
it('switches the form to processing without retaining the sensitive field on screen', () => {
  const { rerender } = render(
    <PiggyvestWalletSetupPanel {...props} setup={setup('not_started')} />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  rerender(
    <PiggyvestWalletSetupPanel {...props} setup={setup('processing')} />
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.getByRole('button', { name: 'Done' })).toBeOnTheScreen();
});
it('attributes the provider with its logo rather than plain brand text', () => {
  render(<PiggyvestWalletSetupPanel {...props} setup={setup('not_started')} />);
  expect(
    screen.getByRole('image', { name: 'Powered by PiggyVest' })
  ).toBeOnTheScreen();
  expect(screen.queryByText('Powered by PiggyVest')).toBeNull();
});
