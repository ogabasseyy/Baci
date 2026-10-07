import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import {
  createPiggyvestProtectedOfferClient,
  createPiggyvestProtectedOfferController,
} from '@baci/shared/lib';
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

it('uses real bounded shared client and server-observed price state, then refreshes without republishing', async () => {
  const fixture = protectedOfferFixture();
  const requests: { url: string; method?: string }[] = [];
  let observed = fixture.observation;
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method });
    const bytes = new TextEncoder().encode(
      JSON.stringify(init?.method === 'POST' ? fixture.published : observed)
    );
    const response = new Response(null, {
      headers: { 'content-type': 'application/json' },
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
  const client = createPiggyvestProtectedOfferClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:4199',
      endpointPath: '/protected-offer',
      credentials: 'omit',
    },
    goalId: fixture.source.goalId,
    fetch: fetchImplementation,
    getCsrfToken: csrf,
    isCurrent: () => true,
  });
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const binding = createPiggyvestProtectedOfferController({
    source,
    tenantKey: 'synthetic',
    offerId: fixture.receipt.offerId,
    client,
    isCurrent: () => true,
  });
  render(
    <StartSavingsScreen
      staging={{
        environment: 'staging',
        source,
        sessionKey: fixture.source.sessionKey,
        goalId: fixture.source.goalId,
        protectedOfferBinding: binding,
        onAccept: async () => undefined,
      }}
    />
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh protected offer' })
    );
  });
  expect(screen.getByText(/Server observed: active/)).toBeOnTheScreen();
  observed = {
    ...observed,
    pricePromise: 'expired',
    observedAt: '2026-09-20T00:00:00Z',
  };
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh protected offer' })
    );
  });
  expect(screen.getByText(/Server observed: expired/)).toBeOnTheScreen();
  expect(requests.map((request) => request.method)).toEqual([
    'POST',
    'GET',
    'GET',
  ]);
  expect(csrf).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('checkbox')).toBeNull();
});
