import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  piggyvestPurchaseSchemas,
  piggyvestSavingsScreenSchema,
} from '@baci/shared/contracts';
import {
  createPiggyvestDeviceChangeClient,
  createPiggyvestDeviceChangeController,
  createPiggyvestPurchaseController,
} from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { deviceChangeFixture } from '../../../../../packages/shared/src/test-fixtures/piggyvest-device-change';
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
  'none',
  'unmount',
  'sibling',
] as const)('actual native screen and shared HTTP client enforce post-CSRF device guard (%s)', async (change) => {
  const fixture = deviceChangeFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const requests: RequestInit[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    if (init) requests.push(init);
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
  };
  let release: ((token: string) => void) | undefined;
  const csrf = jest.fn(async () => 'synthetic-csrf');
  const client = createPiggyvestDeviceChangeClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:4199',
      endpointPath: '/device-change',
      credentials: 'omit',
    },
    goalId: fixture.command.goalId,
    fetch: fetchImplementation,
    getCsrfToken: csrf,
    isCurrent: () => true,
  });
  const deviceChangeBinding = createPiggyvestDeviceChangeController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.command.operationId,
    client,
    isCurrent: () => true,
  });
  const unavailable = async (): Promise<never> => {
    throw new Error('Not used');
  };
  const purchaseBinding = createPiggyvestPurchaseController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.command.operationId,
    client: { quote: unavailable, prepare: unavailable, status: unavailable },
    isCurrent: () => true,
  });
  const view = render(
    <StartSavingsScreen
      staging={{
        environment: 'staging',
        source,
        sessionKey: fixture.source.sessionKey,
        goalId: fixture.command.goalId,
        deviceChangeBinding,
        deviceChangeSelection: fixture.selection,
        purchaseBinding,
        purchaseSelection: piggyvestPurchaseSchemas.selection.parse(
          purchaseFixture().selection
        ),
        onAccept: async () => undefined,
      }}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Review purchase quote' })
  ).not.toBeDisabled();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Review device change' })
    );
  });
  csrf.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      })
  );
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Accept exact device change' })
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm device change' })
    );
  });
  expect(release).toBeDefined();
  expect(
    screen.getByRole('button', { name: 'Review purchase quote' })
  ).toBeDisabled();
  if (change === 'unmount') view.unmount();
  if (change === 'sibling')
    await act(async () => {
      purchaseBinding.invalidate();
    });
  await act(async () => {
    release?.('synthetic-csrf');
  });
  expect(requests).toHaveLength(change === 'none' ? 2 : 1);
  if (change === 'none') {
    expect(JSON.parse(String(requests[1].body))).toEqual(fixture.command);
    expect(requests[1]).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      method: 'POST',
    });
  }
  expect(deviceChangeBinding.read(source)?.status).toBe(
    change === 'none' ? 'confirmed' : 'uncertain'
  );
});
