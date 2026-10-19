import { createPiggyvestCancellationController } from '@baci/shared/lib';

it.each([
  'requires_reconciliation',
  'absent',
  'unavailable',
  'error',
] as const)('fresh %s overrides cached preparation, including remount', async (status) => {
  const operationId = '33333333-3333-4333-8333-333333333333';
  const prepare = jest.fn(async () => ({
    status: 'prepared',
    goalId,
    operationId,
    collectionPaused: true,
    dispatch: 'contract_gap',
    interestDisposition: 'unresolved',
  }));
  const recover = jest.fn(async () => {
    if (status === 'error') throw new Error('private');
    return {
      status,
      goalId,
      requestedOperationId: operationId,
      operationId: status === 'requires_reconciliation' ? operationId : null,
      retry: 'not_authorized',
      dispatch: 'contract_gap',
      reservation: status === 'unavailable' ? 'may_be_retained' : 'unknown',
      ...(status === 'requires_reconciliation'
        ? { interestDisposition: 'unresolved' }
        : {}),
    };
  });
  const binding = createPiggyvestCancellationController({
    source,
    tenantKey: 'tenant',
    operationId,
    isCurrent: () => true,
    prepare,
    recover,
    quote: {
      status: 'quote_available',
      goalId,
      revisionId,
      termsVersion: source.policy.terms.version,
      termsHash: source.policy.terms.hash,
      consentVersion: '2026-09-11',
      principalKobo: 10000,
      paidInterestKobo: 100,
      pendingInterestKobo: 200,
      interestDisposition: 'unresolved',
      dispatch: 'contract_gap',
    },
  });
  const initial = binding.read(source);
  if (initial?.status !== 'review') throw new Error('fixture');
  await binding.prepare(initial.command);
  expect(binding.read(source)?.status).toBe('prepared');
  const view = render(
    <BoundCancellationReview source={source} binding={binding} />
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh cancellation status' })
    );
  });
  expect(screen.queryByText(/Principal reservation retained/)).toBeNull();
  expect(
    screen.getByText(
      status === 'absent'
        ? /does not authorize a retry/
        : /Reservation may be retained/
    )
  ).toBeOnTheScreen();
  view.unmount();
  render(<BoundCancellationReview source={source} binding={binding} />);
  expect(screen.queryByText(/Principal reservation retained/)).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(recover).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('private')).toBeNull();
});

import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PiggyvestCancellationBinding as BoundCancellationReview } from './PiggyvestCancellationBinding';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
const goalId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId,
    device: {
      productName: 'Synthetic phone',
      variant: '256GB',
      condition: 'New',
    },
    terms: {
      version: 'synthetic',
      hash: 'a'.repeat(64),
      text: 'Synthetic terms',
    },
    consent: 'accepted',
  },
  eligibility: { status: 'blocked' },
  funding: { status: 'unavailable' },
  progress: { status: 'unavailable' },
} as const;

it.each([
  'absent',
  'unavailable',
] as const)('shows recovery %s without enabling preparation', async (status) => {
  const recover = jest.fn(async () => ({
    status,
    goalId,
    requestedOperationId: null,
    operationId: null,
    retry: 'not_authorized',
    dispatch: 'contract_gap',
    reservation: status === 'absent' ? 'unknown' : 'may_be_retained',
  }));
  const binding = createPiggyvestCancellationController({
    source,
    tenantKey: 'tenant',
    isCurrent: () => true,
    recover,
  });
  render(<BoundCancellationReview source={source} binding={binding} />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh cancellation status' })
    );
  });
  expect(recover).toHaveBeenCalledWith({ goalId });
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
  expect(
    screen.getByText(
      status === 'absent'
        ? /does not authorize a retry/
        : /Reservation may be retained/
    )
  ).toBeOnTheScreen();
});
it('fails closed for absent controller', () => {
  render(<BoundCancellationReview source={source} binding={null} />);
  expect(screen.getByText('Cancellation is unavailable.')).toBeOnTheScreen();
});
it('hides a previously recovered reservation during refresh and after a failed read', async () => {
  let fail: (reason: Error) => void = () => undefined;
  const recovered = {
    status: 'prepared',
    goalId,
    requestedOperationId: null,
    operationId: revisionId,
    retry: 'not_authorized',
    dispatch: 'contract_gap',
    reservation: 'retained',
    interestDisposition: 'unresolved',
    originalDisclosure: {
      revisionId,
      termsVersion: source.policy.terms.version,
      termsHash: source.policy.terms.hash,
      consentVersion: '2026-09-11',
      principalKobo: 10000,
      paidInterestKobo: 100,
      pendingInterestKobo: 200,
    },
  };
  const recover = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce(recovered)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
  const binding = createPiggyvestCancellationController({
    source,
    tenantKey: 'tenant',
    isCurrent: () => true,
    recover,
  });
  render(<BoundCancellationReview source={source} binding={binding} />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh cancellation status' })
    );
  });
  expect(screen.getByText(/Principal reservation retained/)).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh cancellation status' })
    );
  });
  expect(screen.queryByText(/Principal reservation retained/)).toBeNull();
  expect(screen.queryByText(/Original disclosure/)).toBeNull();
  await act(async () => {
    fail(new Error('private'));
  });
  expect(screen.queryByText(/Principal reservation retained/)).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
});
