import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PiggyvestSavingsScreen } from './PiggyvestSavingsScreen';
import type { PiggyvestSavingsScreenInput } from './PiggyvestSavingsScreen.types';
import { StartSavingsScreen } from './StartSavingsScreen';

const mockLegacy = jest.fn(() => ({ isRefetching: false, refetch: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => mockLegacy(),
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));

const goalId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const device = {
  productName: 'Synthetic phone',
  variant: '256GB',
  condition: 'New',
};
const policy = {
  status: 'draft',
  goalId,
  revisionId,
  device,
  terms: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic reviewed terms only.',
  },
  consent: 'required',
} as const;
function fixture(): PiggyvestSavingsScreenInput & {
  source: Extract<
    NonNullable<PiggyvestSavingsScreenInput['source']>,
    { status: 'ready' }
  >;
} {
  return {
    environment: 'staging',
    sessionKey: 'synthetic-session',
    goalId,
    source: {
      environment: 'staging',
      status: 'ready',
      sessionKey: 'synthetic-session',
      goalId,
      policy,
      eligibility: {
        status: 'allowed',
        sessionKey: 'synthetic-session',
        goalId,
        revisionId,
        termsHash: policy.terms.hash,
        termsVersion: policy.terms.version,
      },
      progress: {
        status: 'ready',
        decision: {
          purchasingPowerKobo: 12345,
          devicePriceKobo: 50000,
          readiness: 'continue_saving',
          purchaseAction: 'blocked',
        },
        pendingInterestKobo: 500,
      },
      funding: {
        status: 'ready',
        accounts: [
          {
            accountNumber: '0000000000',
            accountName: 'Synthetic account',
            bankName: 'Synthetic test bank',
          },
        ],
      },
    },
    onAccept: jest.fn(async () => undefined),
  };
}

describe('isolated native PiggyVest savings', () => {
  it.each([
    'goal',
    'environment',
  ])('rejects a mismatched local %s binding', (change) => {
    const input = fixture();
    input.source.policy = { ...policy, consent: 'accepted' };
    if (change === 'goal') input.goalId = revisionId;
    else Object.assign(input, { environment: 'production' });
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('Synthetic phone')).toBeNull();
    expect(screen.queryByText('0000000000')).toBeNull();
  });
  it.each([
    'loading',
    'unavailable',
    'unauthenticated',
  ] as const)('accepts a serialized %s source without retained funding', (status) => {
    const input: PiggyvestSavingsScreenInput = {
      ...fixture(),
      source: { environment: 'staging', status },
    };
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('0000000000')).toBeNull();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('rejects array readiness rather than coercing it into a funding eligibility key', () => {
    const input = fixture();
    input.source.policy = { ...policy, consent: 'accepted' };
    if (input.source.progress.status !== 'ready') throw new Error('fixture');
    Object.assign(input.source.progress.decision, {
      readiness: ['not_available'],
    });
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(
      screen.getByText('Savings status is unavailable.')
    ).toBeOnTheScreen();
  });
  it.each([
    'sessionKey',
    'goalId',
    'revisionId',
    'termsHash',
    'termsVersion',
  ])('blocks mismatched eligibility %s', (field) => {
    const input = fixture();
    input.source.policy = { ...policy, consent: 'accepted' };
    Object.assign(input.source.eligibility, {
      [field]: field.endsWith('Id')
        ? '33333333-3333-4333-8333-333333333333'
        : field === 'termsHash'
          ? 'b'.repeat(64)
          : 'other',
    });
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByText('NGN 123.45')).toBeNull();
  });
  it.each([
    'blocked',
    'pending',
    'unavailable',
  ] as const)('accepted consent alone does not bypass %s eligibility', (status) => {
    const input = fixture();
    input.source.policy = { ...policy, consent: 'accepted' };
    input.source.eligibility = { status };
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('0000000000')).toBeNull();
  });
  it('rejects extra DTO data rather than retaining funding', () => {
    const input = fixture();
    input.source.policy = { ...policy, consent: 'accepted' };
    Object.assign(input.source, { providerWalletId: 'private' });
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByText('Synthetic phone')).toBeNull();
  });
  it.each([
    { status: 'loading' },
    { status: 'unavailable' },
    { ...policy, terms: {} },
  ])('renders no stale device or funding for incomplete policy %j', (value) => {
    const input = fixture();
    Object.assign(input.source, { policy: value });
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.queryByText('Synthetic phone')).toBeNull();
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('branches before the legacy controller mounts, including explicit unavailable staging', () => {
    const view = render(<StartSavingsScreen staging={fixture()} />);
    expect(mockLegacy).not.toHaveBeenCalled();
    expect(screen.getByText('Draft policy review')).toBeOnTheScreen();
    view.rerender(<StartSavingsScreen staging={null} />);
    expect(mockLegacy).not.toHaveBeenCalled();
    view.rerender(<StartSavingsScreen />);
    expect(mockLegacy).toHaveBeenCalled();
  });
  it('shows exact terms with unchecked consent; callback success never reveals funding', async () => {
    const input = fixture();
    render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.getByText('Synthetic phone')).toBeOnTheScreen();
    expect(screen.getByText('256GB')).toBeOnTheScreen();
    expect(
      screen.getByText('Synthetic reviewed terms only.')
    ).toBeOnTheScreen();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveAccessibilityState({ checked: false });
    expect(
      screen.getByRole('button', { name: 'Accept draft terms' })
    ).toBeDisabled();
    fireEvent.press(checkbox);
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Accept draft terms' })
      );
    });
    expect(input.onAccept).toHaveBeenCalledWith({
      goalId,
      revisionId,
      termsVersion: 'synthetic-v1',
      termsHash: 'a'.repeat(64),
      accepted: true,
    });
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(
      screen.getByText(
        'Acceptance submitted. Refresh to confirm recorded consent.'
      )
    ).toBeOnTheScreen();
  });
  it('blocks double submission and supports generic failure retry', async () => {
    const input = fixture();
    let reject: (error: Error) => void = () => undefined;
    input.onAccept = jest.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    );
    render(<PiggyvestSavingsScreen staging={input} />);
    fireEvent.press(screen.getByRole('checkbox'));
    const button = screen.getByRole('button', { name: 'Accept draft terms' });
    fireEvent.press(button);
    fireEvent.press(button);
    expect(input.onAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Submitting acceptance…')).toBeOnTheScreen();
    await act(async () => {
      reject(new Error('private detail'));
    });
    expect(
      screen.getByRole('button', { name: 'Retry acceptance' })
    ).toBeOnTheScreen();
    expect(screen.queryByText('private detail')).toBeNull();
    jest.mocked(input.onAccept).mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Retry acceptance' }));
    });
    expect(input.onAccept).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(
        'Acceptance submitted. Refresh to confirm recorded consent.'
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText('0000000000')).toBeNull();
  });
  it('resets consent and suppresses old completion after context switches and logout', async () => {
    const input = fixture();
    let complete: () => void = () => undefined;
    input.onAccept = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const view = render(<PiggyvestSavingsScreen staging={input} />);
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByRole('button', { name: 'Accept draft terms' }));
    const next = fixture();
    next.source = {
      ...next.source,
      policy: { ...policy, revisionId: '33333333-3333-4333-8333-333333333333' },
    };
    view.rerender(<PiggyvestSavingsScreen staging={next} />);
    expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
      checked: false,
    });
    await act(async () => {
      complete();
    });
    expect(
      screen.queryByText(
        'Acceptance submitted. Refresh to confirm recorded consent.'
      )
    ).toBeNull();
    view.rerender(
      <PiggyvestSavingsScreen staging={{ ...next, sessionKey: null }} />
    );
    expect(screen.queryByText('Synthetic phone')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('shows funding only for accepted server policy and matched eligible server context', () => {
    const input = fixture();
    input.source = {
      ...input.source,
      policy: { ...policy, consent: 'accepted' },
    };
    const view = render(<PiggyvestSavingsScreen staging={input} />);
    expect(screen.getByText('0000000000')).toBeOnTheScreen();
    expect(screen.getByText('NGN 123.45')).toBeOnTheScreen();
    expect(
      screen.getByText('Pending interest (not spendable): NGN 5.00')
    ).toBeOnTheScreen();
    view.rerender(
      <PiggyvestSavingsScreen
        staging={{
          ...input,
          source: { ...input.source, sessionKey: 'wrong-session' },
        }}
      />
    );
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByText('NGN 123.45')).toBeNull();
  });
});
