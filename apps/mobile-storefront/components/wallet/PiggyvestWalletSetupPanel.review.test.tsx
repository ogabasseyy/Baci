import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

const setup = {
  scopeKey: 'merchant:user',
  account: null,
  state: 'unavailable' as const,
  recoverable: false,
  reviewRequired: true,
  justCreated: false,
  acknowledgeReady: jest.fn(),
  hasCheckError: true,
  isChecking: false,
  delayed: false,
  submitting: false,
  refresh: jest.fn(),
  submit: jest.fn(async () => undefined),
  recover: jest.fn(async () => undefined),
} satisfies ReturnType<typeof usePiggyvestWalletSetup>;

it('shows safe review guidance and never exposes BVN re-entry for terminal holds', () => {
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      setup={setup}
      onClose={jest.fn()}
    />
  );

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Your PiggyVest wallet setup needs review. Please contact support before trying again.'
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Create account number' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Re-enter BVN to recover wallet setup',
    })
  ).toBeNull();
});
