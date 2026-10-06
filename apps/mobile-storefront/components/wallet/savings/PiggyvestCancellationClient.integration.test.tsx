import { createServer, request } from 'node:http';
import { ReadableStream } from 'node:stream/web';
import { createPiggyvestCancellationClientBinding } from '@baci/shared/lib';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { PiggyvestCancellationBinding } from './PiggyvestCancellationBinding';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '33333333-3333-4333-8333-333333333333';
const disclosure = {
  revisionId: goalId,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
};
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId: goalId,
    device: { productName: 'Synthetic', variant: null, condition: 'New' },
    terms: {
      version: 'synthetic',
      hash: disclosure.termsHash,
      text: 'Synthetic terms',
    },
    consent: 'accepted',
  },
  eligibility: { status: 'blocked' },
  funding: { status: 'unavailable' },
  progress: { status: 'unavailable' },
} as const;

it('uses actual loopback sockets with synthetic endpoints, retaining a lost response operation across UI reload', async () => {
  const commands: unknown[] = [];
  let quotes = 0;
  const server = createServer((incoming, outgoing) => {
    if (incoming.headers.cookie !== 'synthetic-session=local') {
      outgoing.writeHead(401).end();
      return;
    }
    if (incoming.method === 'POST') {
      if (incoming.headers['x-csrf-token'] !== 'synthetic-csrf') {
        outgoing.writeHead(403).end();
        return;
      }
      let body = '';
      incoming.on('data', (chunk) => {
        body += String(chunk);
      });
      incoming.on('end', () => {
        commands.push(JSON.parse(body));
        outgoing.destroy();
      });
      return;
    }
    outgoing.setHeader('content-type', 'application/json');
    if (incoming.url === `/recovery?goalId=${goalId}`) {
      outgoing.end(
        JSON.stringify({
          status: 'prepared',
          goalId,
          requestedOperationId: null,
          operationId,
          reservation: 'retained',
          retry: 'not_authorized',
          dispatch: 'contract_gap',
          interestDisposition: 'unresolved',
          originalDisclosure: disclosure,
        })
      );
    } else if (incoming.url === `/cancel?goalId=${goalId}`) {
      quotes += 1;
      outgoing.end(
        JSON.stringify({
          status: 'quote_available',
          goalId,
          ...disclosure,
          interestDisposition: 'unresolved',
          dispatch: 'contract_gap',
        })
      );
    } else outgoing.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture');
  const fetch: typeof globalThis.fetch = async (url, init) =>
    new Promise((resolve, reject) => {
      if (init?.redirect !== 'error' || init.credentials !== 'include') {
        reject(new Error('unsupported transport'));
        return;
      }
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const socket = request(
        String(url),
        {
          method: init.method,
          headers: { ...headers, cookie: 'synthetic-session=local' },
          signal: init.signal ?? undefined,
        },
        (incoming) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              incoming.on('data', (chunk: Buffer) =>
                controller.enqueue(new Uint8Array(chunk))
              );
              incoming.on('end', () => controller.close());
              incoming.on('error', (error) => controller.error(error));
            },
            cancel() {
              incoming.destroy();
            },
          });
          resolve({
            status: incoming.statusCode ?? 500,
            redirected: false,
            url: String(url),
            headers: new Headers({
              'content-type': String(incoming.headers['content-type']),
            }),
            body,
          } as unknown as Response);
        }
      );
      socket.on('error', reject);
      socket.end(init?.body ? String(init.body) : undefined);
    });
  const getCsrfToken = jest.fn(async () => 'synthetic-csrf');
  const http = {
    configuration: {
      mode: 'local_test',
      baseUrl: `http://127.0.0.1:${address.port}`,
      endpointPath: '/cancel',
      recoveryEndpointPath: '/recovery',
      credentials: 'include',
    },
    fetch,
    getCsrfToken,
  };
  let current = true;
  try {
    const binding = await createPiggyvestCancellationClientBinding({
      mode: 'prepare',
      source,
      tenantKey: 'tenant',
      operationId,
      http,
      isCurrent: () => current,
    });
    const view = render(
      <PiggyvestCancellationBinding source={source} binding={binding} />
    );
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
    await waitFor(() => expect(commands).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByText(/Reservation may be retained/)).toBeOnTheScreen()
    );
    expect(commands[0]).toEqual({
      goalId,
      operationId,
      ...disclosure,
      accepted: true,
    });
    view.unmount();
    const recovery = await createPiggyvestCancellationClientBinding({
      mode: 'recovery',
      source,
      tenantKey: 'tenant',
      http,
      isCurrent: () => current,
    });
    expect(quotes).toBe(1);
    render(<PiggyvestCancellationBinding source={source} binding={recovery} />);
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Refresh cancellation status' })
      );
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Principal reservation retained/)
      ).toBeOnTheScreen()
    );
    expect(
      screen.queryByRole('button', { name: 'Prepare cancellation' })
    ).toBeNull();
    expect(commands).toHaveLength(1);
    expect(getCsrfToken).toHaveBeenCalledTimes(1);
    current = false;
    await expect(recovery.recover()).rejects.toThrow(
      'Cancellation unavailable'
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
