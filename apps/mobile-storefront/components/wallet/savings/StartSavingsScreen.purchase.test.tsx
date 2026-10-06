import {
  piggyvestPurchaseSchemas,
  piggyvestSavingsScreenSchema,
} from '@baci/shared/contracts';
import { createPiggyvestPurchaseController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { purchaseFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { StartSavingsScreen } from './StartSavingsScreen';

const mockLegacy = jest.fn();
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => mockLegacy(),
}));
jest.mock('./StartSavingsForm', () => ({ StartSavingsForm: () => null }));
jest.mock('./StartSavingsModals', () => ({ StartSavingsModals: () => null }));

function setup(mode: 'prepare' | 'recovery' = 'prepare') {
  const fixture = purchaseFixture();
  const source = piggyvestSavingsScreenSchema.parse({
    ...fixture.source,
    eligibility: {
      status: 'allowed',
      sessionKey: fixture.source.sessionKey,
      goalId: fixture.goalId,
      revisionId: fixture.command.quote.revisionId,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
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
    quote: jest.fn(async () =>
      piggyvestPurchaseSchemas.published.parse(fixture.published)
    ),
    prepare: jest.fn(async () =>
      piggyvestPurchaseSchemas.receipt.parse(fixture.receipt)
    ),
    status: jest.fn(async () =>
      piggyvestPurchaseSchemas.status.parse(fixture.status)
    ),
  };
  const controller = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic-tenant',
    operationId: fixture.operationId,
    mode,
    client,
    isCurrent: () => true,
  });
  const staging = {
    environment: 'staging' as const,
    source,
    sessionKey: fixture.source.sessionKey,
    goalId: fixture.goalId,
    onAccept: async () => undefined,
    purchaseBinding: controller,
    purchaseSelection: piggyvestPurchaseSchemas.selection.parse(
      fixture.selection
    ),
  };
  return { fixture, client, controller, staging };
}

it.each([
  'prepared',
  'uncertain',
] as const)('actual staging branch hides cached bank before purchase settles %s without legacy fallback', async (outcome) => {
  const { client, fixture, staging } = setup();
  let settle: (() => void) | undefined;
  client.prepare.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        settle = () =>
          outcome === 'prepared'
            ? resolve(piggyvestPurchaseSchemas.receipt.parse(fixture.receipt))
            : reject(new Error('private'));
      })
  );
  render(<StartSavingsScreen staging={staging} />);
  expect(screen.getByText('Synthetic bank')).toBeOnTheScreen();
  await act(async () =>
    fireEvent.press(
      screen.getByRole('button', { name: 'Review purchase quote' })
    )
  );
  expect(screen.getByText('Synthetic phone — 256GB — new')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  await act(async () => settle?.());
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Prepare purchase' })).toBeNull();
  expect(client.prepare).toHaveBeenCalledTimes(1);
  expect(mockLegacy).not.toHaveBeenCalled();
});

it('reload recovery never quotes or prepares and uncertain current observations never restore funding', async () => {
  const { client, staging, fixture } = setup('recovery');
  client.status.mockResolvedValue(
    piggyvestPurchaseSchemas.status.parse({
      ...fixture.status,
      current: {
        ...fixture.status.current,
        status: 'requires_reconciliation',
        reservation: 'unknown',
        balances: null,
      },
    })
  );
  render(<StartSavingsScreen staging={staging} />);
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  await act(async () =>
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh purchase status' })
    )
  );
  expect(
    screen.getByText(/Purchase outcome requires reconciliation/)
  ).toBeOnTheScreen();
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  expect(client.quote).not.toHaveBeenCalled();
  expect(client.prepare).not.toHaveBeenCalled();
});

it('invalid present binding hides funding and does not invoke legacy', () => {
  const { staging } = setup();
  render(
    <StartSavingsScreen staging={{ ...staging, purchaseBinding: null }} />
  );
  expect(screen.queryByText('Synthetic bank')).toBeNull();
  expect(screen.getByText('Purchase is unavailable.')).toBeOnTheScreen();
});

it('ignores an old quote after an exact variant or session switch', async () => {
  const { client, staging, fixture } = setup();
  let settle: (() => void) | undefined;
  client.quote.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = () =>
          resolve(piggyvestPurchaseSchemas.published.parse(fixture.published));
      })
  );
  const view = render(<StartSavingsScreen staging={staging} />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Review purchase quote' })
  );
  const changed = piggyvestSavingsScreenSchema.parse({
    ...fixture.source,
    policy: {
      ...fixture.source.policy,
      device: { ...fixture.source.policy.device, variant: '512GB' },
    },
  });
  view.rerender(
    <StartSavingsScreen staging={{ ...staging, source: changed }} />
  );
  await act(async () => settle?.());
  expect(screen.queryByRole('button', { name: 'Prepare purchase' })).toBeNull();
  expect(client.prepare).not.toHaveBeenCalled();
});
