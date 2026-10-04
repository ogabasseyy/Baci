import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import { createPiggyvestDraftClosureController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { purchaseFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { StartSavingsScreen } from './StartSavingsScreen';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => {
    throw new Error('Legacy must not mount');
  },
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));

it.each([
  'closed',
  'unknown',
  'exposed',
] as const)('actual screen uses server closure evidence (%s), never inferring zero or refund', async (outcome) => {
  const fixture = purchaseFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const available = {
    status: 'available',
    action: 'close_plan',
    goalId: fixture.goalId,
    revisionId: fixture.operationId,
    termsVersion: 'synthetic',
    termsHash: 'a'.repeat(64),
  };
  const close = jest.fn(async () => {
    if (outcome === 'unknown') throw new Error('private');
    return {
      ...available,
      status: 'closed',
      operationId: fixture.operationId,
      closedAt: '2026-09-12T12:00:00Z',
      refundIssued: false,
      providerWalletDeleted: false,
    };
  });
  const binding = createPiggyvestDraftClosureController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    read: async () =>
      outcome === 'exposed'
        ? {
            status: 'requires_reconciliation',
            goalId: fixture.goalId,
            reason: 'provider_zero_unverified',
          }
        : available,
    close,
    isCurrent: () => true,
  });
  render(
    <StartSavingsScreen
      staging={{
        environment: 'staging',
        source,
        sessionKey: fixture.source.sessionKey,
        goalId: fixture.goalId,
        draftClosureBinding: binding,
        onAccept: async () => undefined,
      }}
    />
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh plan closure' })
    );
  });
  if (outcome === 'exposed') {
    expect(
      screen.getByText(/Funding exposure requires reconciliation/)
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Close plan' })).toBeNull();
    expect(close).not.toHaveBeenCalled();
  } else {
    fireEvent.press(
      screen.getByText(
        'I confirm closing this unfunded draft under these terms.'
      )
    );
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Close plan' }));
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        outcome === 'closed'
          ? 'Plan closed. No refund issued; no provider wallet deleted.'
          : 'Closure outcome unconfirmed. Refresh status; do not resubmit.'
      )
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Close plan' })).toBeNull();
  }
  expect(
    screen.getByText('Funding details are unavailable.')
  ).toBeOnTheScreen();
});
