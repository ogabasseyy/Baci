import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  piggyvestPurchaseSchemas,
  piggyvestSavingsScreenSchema,
} from '@baci/shared/contracts';
import {
  createPiggyvestCancellationClientBinding,
  createPiggyvestPurchaseController,
} from '@baci/shared/lib';
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
  'purchase',
  'unmount',
  'none',
] as const)('checks sibling state after cancellation CSRF await (%s), without blocking its own pending attempt', async (change) => {
  const fixture = purchaseFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const quote = {
    status: 'quote_available',
    goalId: fixture.goalId,
    revisionId: fixture.operationId,
    termsVersion: 'synthetic',
    termsHash: 'a'.repeat(64),
    consentVersion: '2026-09-11',
    principalKobo: 10000,
    paidInterestKobo: 0,
    pendingInterestKobo: 0,
    interestDisposition: 'unresolved',
    dispatch: 'contract_gap',
  };
  const fetchImplementation: typeof fetch = jest.fn(async (input, init) => {
    const value =
      init?.method === 'POST'
        ? {
            status: 'prepared',
            goalId: fixture.goalId,
            operationId: fixture.goalId,
            collectionPaused: true,
            dispatch: 'contract_gap',
            interestDisposition: 'unresolved',
          }
        : quote;
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const response = new Response(null, {
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperties(response, {
      url: { value: String(input) },
      redirected: { value: false },
      body: {
        value: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      },
    });
    return response;
  });
  let release: ((token: string) => void) | undefined;
  const cancellation = await createPiggyvestCancellationClientBinding({
    mode: 'prepare',
    source,
    tenantKey: 'synthetic',
    operationId: fixture.goalId,
    isCurrent: () => true,
    http: {
      configuration: {
        mode: 'local_test',
        baseUrl: 'http://127.0.0.1:4199',
        endpointPath: '/cancel',
        recoveryEndpointPath: '/recovery',
        credentials: 'omit',
      },
      fetch: fetchImplementation,
      getCsrfToken: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    },
  });
  const purchaseBinding = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    isCurrent: () => true,
    client: {
      quote: async () =>
        piggyvestPurchaseSchemas.published.parse(fixture.published),
      prepare: async () =>
        piggyvestPurchaseSchemas.receipt.parse(fixture.receipt),
      status: async () => piggyvestPurchaseSchemas.status.parse(fixture.status),
    },
  });
  await purchaseBinding.quote(fixture.selection);
  const view = render(
    <StartSavingsScreen
      staging={{
        environment: 'staging',
        source,
        goalId: fixture.goalId,
        sessionKey: fixture.source.sessionKey,
        cancellation,
        purchaseBinding,
        onAccept: async () => undefined,
      }}
    />
  );
  fireEvent.press(
    screen.getByRole('checkbox', { name: /I accept cancellation preparation/ })
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
  });
  expect(release).toBeDefined();
  if (change === 'unmount') view.unmount();
  if (change === 'purchase') {
    await act(async () => {
      purchaseBinding.invalidate();
    });
  }
  await act(async () => {
    release?.('synthetic-csrf');
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(change === 'none' ? 2 : 1);
  expect(cancellation.read(source)?.status).toBe(
    change === 'none' ? 'prepared' : 'uncertain'
  );
});
