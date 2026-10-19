import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  piggyvestPurchaseSchemas,
  piggyvestSavingsScreenSchema,
} from '@baci/shared/contracts';
import {
  createPiggyvestCancellationController,
  createPiggyvestPurchaseClient,
  createPiggyvestPurchaseController,
} from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { purchaseFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { StartSavingsScreen } from './StartSavingsScreen';

it.each([
  'unmount',
  'invalidated cancellation',
] as const)('does not dispatch prepare after deferred CSRF and %s, retaining uncertainty', async (change) => {
  const fixture = purchaseFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  let release: ((token: string) => void) | undefined;
  const csrf = jest.fn(async () => 'synthetic-csrf');
  const fetchImplementation: typeof fetch = jest.fn(
    async (input: RequestInfo | URL) => {
      const value = String(input).endsWith('/quote')
        ? fixture.published
        : fixture.receipt;
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
    }
  );
  const client = createPiggyvestPurchaseClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:4199',
      endpointPath: '/purchase',
      credentials: 'omit',
    },
    goalId: fixture.goalId,
    fetch: fetchImplementation,
    getCsrfToken: csrf,
    isCurrent: () => true,
  });
  const purchaseBinding = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    client,
    isCurrent: () => true,
  });
  const cancellation = createPiggyvestCancellationController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.goalId,
    isCurrent: () => true,
    prepare: async () => {
      throw new Error('unknown');
    },
    quote: {
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
    },
  });
  const staging = {
    environment: 'staging' as const,
    source,
    sessionKey: fixture.source.sessionKey,
    goalId: fixture.goalId,
    cancellation,
    purchaseBinding,
    purchaseSelection: piggyvestPurchaseSchemas.selection.parse(
      fixture.selection
    ),
    onAccept: async () => undefined,
  };
  const view = render(<StartSavingsScreen staging={staging} />);
  await act(async () =>
    fireEvent.press(
      screen.getByRole('button', { name: 'Review purchase quote' })
    )
  );
  csrf.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      })
  );
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Confirm exact purchase quote' })
  );
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }));
  });
  expect(release).toBeDefined();
  if (change === 'unmount') view.unmount();
  else {
    await act(async () => {
      cancellation.invalidate();
    });
  }
  await act(async () => release?.('synthetic-csrf'));
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(purchaseBinding.read(source)?.status).toBe('uncertain');
});

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

it('connects actual native screen to shared HTTP client with explicit synthetic bounded transport, then recovery only', async () => {
  const fixture = purchaseFixture();
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const value = url.includes('/status?')
      ? fixture.status
      : url.endsWith('/prepare')
        ? fixture.receipt
        : fixture.published;
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const response = new Response(null, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(bytes.length),
      },
    });
    Object.defineProperties(response, {
      url: { value: url },
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
  };
  const csrf = jest.fn(async () => 'synthetic-csrf');
  const client = createPiggyvestPurchaseClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:4199',
      endpointPath: '/purchase',
      credentials: 'omit',
    },
    goalId: fixture.goalId,
    fetch: fetchImplementation,
    getCsrfToken: csrf,
    isCurrent: () => true,
  });
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const controller = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    client,
    isCurrent: () => true,
  });
  const staging = {
    environment: 'staging' as const,
    source,
    sessionKey: fixture.source.sessionKey,
    goalId: fixture.goalId,
    purchaseBinding: controller,
    purchaseSelection: piggyvestPurchaseSchemas.selection.parse(
      fixture.selection
    ),
    onAccept: async () => undefined,
  };
  const view = render(<StartSavingsScreen staging={staging} />);
  await act(async () =>
    fireEvent.press(
      screen.getByRole('button', { name: 'Review purchase quote' })
    )
  );
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Prepare purchase' }))
  );
  expect(requests).toHaveLength(2);
  expect(JSON.parse(String(requests[1].init?.body))).toEqual(fixture.command);
  expect(requests[1].init).toMatchObject({
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    mode: 'same-origin',
    headers: { 'x-csrf-token': 'synthetic-csrf' },
  });
  view.unmount();
  const reloaded = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.operationId,
    mode: 'recovery',
    client,
    isCurrent: () => true,
  });
  render(
    <StartSavingsScreen staging={{ ...staging, purchaseBinding: reloaded }} />
  );
  await act(async () =>
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh purchase status' })
    )
  );
  expect(
    screen.getByText('Local purchase reservation retained.')
  ).toBeOnTheScreen();
  expect(requests[2].url).toBe(
    `http://127.0.0.1:4199/purchase/status?goalId=${fixture.goalId}&operationId=${fixture.operationId}`
  );
  expect(requests[2].init?.method).toBe('GET');
  expect(csrf).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Prepare purchase' })).toBeNull();
});
