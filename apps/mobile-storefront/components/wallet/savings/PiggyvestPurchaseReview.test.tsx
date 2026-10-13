import { piggyvestPurchaseSchemas } from '@baci/shared/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { purchaseFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { PiggyvestPurchaseReview } from './PiggyvestPurchaseReview';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
const fixture = purchaseFixture();
const quote = piggyvestPurchaseSchemas.published.parse(fixture.published);
const command = piggyvestPurchaseSchemas.confirmation.parse(fixture.command);
const base = {
  quote,
  command,
  contextKey: 'session:goal:variant',
  device: 'Synthetic phone — 256GB — new',
  disabled: false,
};

it('requires explicit confirmation and sends the original exact command once for same-tick taps', async () => {
  let resolve: (() => void) | undefined;
  const onPrepare = jest.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  render(<PiggyvestPurchaseReview {...base} onPrepare={onPrepare} />);
  expect(
    screen.getByRole('button', { name: 'Prepare purchase' })
  ).toBeDisabled();
  fireEvent.press(screen.getByRole('checkbox'));
  act(() => {
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
  });
  expect(onPrepare).toHaveBeenCalledTimes(1);
  expect(onPrepare.mock.calls[0]).toEqual([command]);
  await act(async () => resolve?.());
  expect(screen.getByText(/Not purchased or fulfilled/)).toBeOnTheScreen();
});

it('keeps an uncertain attempt locked after callback rejection', async () => {
  render(
    <PiggyvestPurchaseReview
      {...base}
      onPrepare={async () => {
        throw new Error('private');
      }}
    />
  );
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }))
  );
  expect(screen.getByText(/Refresh authoritative status/)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Prepare purchase' })
  ).toBeDisabled();
  expect(screen.queryByText('private')).toBeNull();
});

it('resets confirmation when exact device context changes and ignores the old completion', async () => {
  let resolve: (() => void) | undefined;
  const onPrepare = () =>
    new Promise<void>((done) => {
      resolve = done;
    });
  const view = render(
    <PiggyvestPurchaseReview {...base} onPrepare={onPrepare} />
  );
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
  view.rerender(
    <PiggyvestPurchaseReview
      {...base}
      contextKey="other-session"
      command={{ ...command, operationId: fixture.goalId }}
      onPrepare={async () => undefined}
    />
  );
  await act(async () => resolve?.());
  expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
    checked: false,
  });
  expect(screen.queryByText(/Refresh authoritative status/)).toBeNull();
});

it('does not reopen an unknown command when the callback is replaced', async () => {
  const view = render(
    <PiggyvestPurchaseReview
      {...base}
      onPrepare={async () => {
        throw new Error('unknown');
      }}
    />
  );
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }))
  );
  const replacement = jest.fn(async () => undefined);
  view.rerender(<PiggyvestPurchaseReview {...base} onPrepare={replacement} />);
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
  expect(replacement).not.toHaveBeenCalled();
});

it('fails closed for a mismatched quote and never exposes a confirmation control', () => {
  render(
    <PiggyvestPurchaseReview
      {...base}
      quote={{
        ...quote,
        quote: { ...quote.quote, revisionId: fixture.goalId },
      }}
      onPrepare={async () => undefined}
    />
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('Purchase review is unavailable.')).toBeOnTheScreen();
});

it('preserves command bytes but does not allow a case-only operation retry, and displays exact cents', async () => {
  const original = {
    ...command,
    operationId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  };
  const onPrepare = jest.fn(async () => undefined);
  const view = render(
    <PiggyvestPurchaseReview
      {...base}
      command={original}
      onPrepare={onPrepare}
    />
  );
  expect(screen.getByText(/fees: ₦0.50/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
  });
  expect(onPrepare).toHaveBeenCalledWith(original);
  view.rerender(
    <PiggyvestPurchaseReview
      {...base}
      command={{ ...original, operationId: original.operationId.toLowerCase() }}
      onPrepare={onPrepare}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Prepare purchase' })
  ).toBeDisabled();
});
