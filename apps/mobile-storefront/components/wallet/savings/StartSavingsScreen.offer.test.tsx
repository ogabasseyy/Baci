import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import { createPiggyvestProtectedOfferController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { protectedOfferFixture } from '../../../../../packages/shared/src/lib/piggyvest-protected-offer.test-support';
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

function setup(mode: 'publish' | 'history' = 'publish') {
  const fixture = protectedOfferFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const client = {
    publish: jest.fn(async () => fixture.published),
    status: jest.fn(async () => fixture.observation),
  };
  const binding = createPiggyvestProtectedOfferController({
    source,
    tenantKey: 'synthetic',
    offerId: fixture.receipt.offerId,
    client,
    isCurrent: () => true,
    mode,
  });
  const staging = {
    environment: 'staging' as const,
    source,
    sessionKey: fixture.source.sessionKey,
    goalId: fixture.source.goalId,
    protectedOfferBinding: binding,
    onAccept: async () => undefined,
  };
  return { fixture, client, binding, staging };
}

it('connects server observation through the real controller without acceptance or funding authority', async () => {
  const { client, staging } = setup();
  render(<StartSavingsScreen staging={staging} />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh protected offer' })
    );
  });
  expect(screen.getByText(/Server observed: active/)).toBeOnTheScreen();
  expect(screen.getByText('Synthetic phone — 256GB — new')).toBeOnTheScreen();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.getByText('Funding details are unavailable.')
  ).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh protected offer' })
    );
  });
  expect(client.publish).toHaveBeenCalledTimes(1);
  expect(client.status).toHaveBeenCalledTimes(2);
});

it('history mode never publishes and unavailable observation cannot fall back to a cached active receipt', async () => {
  const { client, staging } = setup('history');
  render(<StartSavingsScreen staging={staging} />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh protected offer' })
    );
  });
  client.status.mockRejectedValueOnce(new Error('private'));
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh protected offer' })
    );
  });
  expect(screen.queryByText(/Server observed: active/)).toBeNull();
  expect(screen.getByText('Protected offer unavailable.')).toBeOnTheScreen();
  expect(client.publish).not.toHaveBeenCalled();
});

it('ignores a late response after session replacement', async () => {
  const { client, fixture, staging } = setup('history');
  let finish: (() => void) | undefined;
  client.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(fixture.observation);
      })
  );
  const view = render(<StartSavingsScreen staging={staging} />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh protected offer' })
  );
  view.rerender(
    <StartSavingsScreen staging={{ ...staging, sessionKey: 'other' }} />
  );
  await act(async () => {
    finish?.();
  });
  expect(screen.queryByText(/Server observed: active/)).toBeNull();
  expect(screen.queryByText('Synthetic phone — 256GB — new')).toBeNull();
});

it('an invalid optional offer is unavailable without becoming a funding gate', () => {
  const { fixture, staging } = setup();
  const source = piggyvestSavingsScreenSchema.parse({
    ...fixture.source,
    eligibility: {
      status: 'allowed',
      sessionKey: fixture.source.sessionKey,
      goalId: fixture.source.goalId,
      revisionId: fixture.source.policy.revisionId,
      termsHash: fixture.source.policy.terms.hash,
      termsVersion: fixture.source.policy.terms.version,
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
  render(
    <StartSavingsScreen
      staging={{ ...staging, source, protectedOfferBinding: null }}
    />
  );
  expect(screen.getByText('Protected offer unavailable.')).toBeOnTheScreen();
  expect(screen.getByText('Synthetic bank')).toBeOnTheScreen();
});
