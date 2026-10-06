import type { SavingsScreenSource } from '@baci/shared/contracts';
import { createPiggyvestCancellationController } from '@baci/shared/lib';
import { act, render, screen } from '@testing-library/react-native';
import { PiggyvestSavingsScreen } from './PiggyvestSavingsScreen';

it('unsubscribes the replaced authenticated controller without hiding the new context', async () => {
  const previous = createPiggyvestCancellationController({
    source,
    tenantKey: 'tenant',
    operationId,
    quote,
    isCurrent: () => true,
    prepare: async () => undefined,
  });
  const replacementSource = {
    ...source,
    sessionKey: 'replacement',
    eligibility: { ...source.eligibility, sessionKey: 'replacement' },
  };
  const replacement = createPiggyvestCancellationController({
    source: replacementSource,
    tenantKey: 'tenant',
    operationId,
    quote,
    isCurrent: () => true,
    prepare: async () => undefined,
  });
  const view = render(
    <PiggyvestSavingsScreen
      staging={{
        environment: 'staging',
        sessionKey: source.sessionKey,
        goalId,
        source,
        cancellation: previous,
        onAccept: async () => undefined,
      }}
    />
  );
  await screen.findByText('Synthetic bank');
  view.rerender(
    <PiggyvestSavingsScreen
      staging={{
        environment: 'staging',
        sessionKey: replacementSource.sessionKey,
        goalId,
        source: replacementSource,
        cancellation: replacement,
        onAccept: async () => undefined,
      }}
    />
  );
  await screen.findByText('Synthetic bank');
  await act(async () => previous.invalidate());
  expect(screen.queryByText('Synthetic bank')).not.toBeNull();
  view.unmount();
  await act(async () => replacement.invalidate());
});

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'synthetic-session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId: operationId,
    device: {
      productName: 'Synthetic phone',
      variant: '512GB',
      condition: 'New',
    },
    terms: {
      version: 'synthetic',
      hash: 'a'.repeat(64),
      text: 'Synthetic terms',
    },
    consent: 'accepted',
  },
  eligibility: {
    status: 'allowed',
    sessionKey: 'synthetic-session',
    goalId,
    revisionId: operationId,
    termsVersion: 'synthetic',
    termsHash: 'a'.repeat(64),
  },
  funding: {
    status: 'ready',
    accounts: [
      {
        bankName: 'Synthetic bank',
        accountName: 'Synthetic holder',
        accountNumber: 'NOT-REAL',
      },
    ],
  },
  progress: { status: 'unavailable' },
} satisfies Extract<SavingsScreenSource, { status: 'ready' }>;
const quote = {
  status: 'quote_available',
  goalId,
  revisionId: operationId,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 5000,
  paidInterestKobo: 0,
  pendingInterestKobo: 0,
  dispatch: 'contract_gap',
  interestDisposition: 'unresolved',
};

it.each([
  'prepared',
  'uncertain',
] as const)('suppresses cached funding from pending through %s via controller notification', async (outcome) => {
  let finish: ((result: unknown) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const binding = createPiggyvestCancellationController({
    source,
    tenantKey: 'tenant',
    operationId,
    quote,
    isCurrent: () => true,
    prepare: () =>
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  });
  const view = render(
    <PiggyvestSavingsScreen
      staging={{
        environment: 'staging',
        sessionKey: source.sessionKey,
        goalId,
        source,
        cancellation: binding,
        onAccept: async () => undefined,
      }}
    />
  );
  await screen.findByText('Synthetic bank');
  const initial = binding.read(source);
  if (initial?.status !== 'review') throw new Error('fixture');
  let pending: Promise<unknown> | undefined;
  await act(async () => {
    pending = binding.prepare(initial.command).catch(() => undefined);
  });
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  expect(screen.queryByText('NOT-REAL')).toBeNull();
  await act(async () => {
    if (outcome === 'uncertain') fail?.(new Error('lost'));
    else
      finish?.({
        status: 'prepared',
        goalId,
        operationId,
        collectionPaused: true,
        dispatch: 'contract_gap',
        interestDisposition: 'unresolved',
      });
    await pending;
  });
  view.rerender(
    <PiggyvestSavingsScreen
      staging={{
        environment: 'staging',
        sessionKey: source.sessionKey,
        goalId,
        source,
        cancellation: binding,
        onAccept: async () => undefined,
      }}
    />
  );
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  expect(screen.queryByText('NOT-REAL')).toBeNull();
});
