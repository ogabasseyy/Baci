import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import { createPiggyvestDeviceChangeController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { deviceChangeFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-device-change';
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

function setup(mode: 'prepare' | 'recovery' = 'prepare') {
  const fixture = deviceChangeFixture();
  const source = piggyvestSavingsScreenSchema.parse({
    ...fixture.source,
    eligibility: {
      status: 'allowed',
      sessionKey: fixture.source.sessionKey,
      goalId: fixture.source.goalId,
      revisionId: fixture.source.policy.revisionId,
      termsVersion: fixture.source.policy.terms.version,
      termsHash: fixture.source.policy.terms.hash,
    },
    funding: {
      status: 'ready',
      accounts: [
        {
          bankName: 'Synthetic bank',
          accountName: 'Synthetic holder',
          accountNumber: '0000000000',
        },
      ],
    },
  });
  const client = {
    quote: jest.fn(async () => fixture.published),
    confirm: jest.fn(async () => fixture.receipt),
    status: jest.fn(async () => fixture.historical),
  };
  const binding = createPiggyvestDeviceChangeController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.command.operationId,
    mode,
    client,
    isCurrent: () => true,
  });
  const staging = {
    environment: 'staging' as const,
    source,
    sessionKey: fixture.source.sessionKey,
    goalId: fixture.source.goalId,
    deviceChangeBinding: binding,
    deviceChangeSelection: fixture.selection,
    onAccept: async () => undefined,
  };
  return { fixture, source, client, binding, staging };
}

it.each([
  'confirmed',
  'unknown',
] as const)('actual screen hides bank during %s change and never adopts callback as fresh eligibility', async (outcome) => {
  const { fixture, client, staging } = setup();
  let settle: (() => void) | undefined;
  client.confirm.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = () =>
          outcome === 'confirmed'
            ? resolve(fixture.receipt)
            : reject(new Error('private'));
      })
  );
  render(<StartSavingsScreen staging={staging} />);
  expect(screen.getByText('Synthetic bank')).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Review device change' })
    );
  });
  expect(screen.getByText(/Synthetic replacement/)).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Accept exact device change' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm device change' })
  );
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  await act(async () => settle?.());
  expect(client.confirm).toHaveBeenCalledWith(
    fixture.command,
    expect.anything()
  );
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Confirm device change' })
  ).toBeNull();
});

it('reloaded device recovery is historical only, with no quote, new operation or funding', async () => {
  const { client, staging } = setup('recovery');
  render(<StartSavingsScreen staging={staging} />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh device change status' })
    );
  });
  expect(screen.getByText(/Historical device change only/)).toBeOnTheScreen();
  expect(client.quote).not.toHaveBeenCalled();
  expect(client.confirm).not.toHaveBeenCalled();
  expect(screen.queryByText('Synthetic bank')).toBeNull();
});

it('invalid present device binding fails closed and session replacement never displays an old quote', async () => {
  const { staging } = setup();
  const view = render(
    <StartSavingsScreen staging={{ ...staging, deviceChangeBinding: null }} />
  );
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  view.rerender(
    <StartSavingsScreen staging={{ ...staging, sessionKey: 'other-session' }} />
  );
  expect(screen.getByText('Device change unavailable.')).toBeOnTheScreen();
  expect(screen.queryByText(/Synthetic replacement/)).toBeNull();
});
