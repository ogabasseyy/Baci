/** @vitest-environment node */
import { renderToReadableStream } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('./customer-login-page', () => ({
  default: () => <h1>Sign in to your store</h1>,
}));

import LoginPage from './page';

it('streams the login form before its metadata request marker resolves', async () => {
  const request = Promise.withResolvers<void>();
  mocks.connection.mockReturnValue(request.promise);
  const stream = await renderToReadableStream(
    <main>
      <LoginPage />
    </main>,
    {
      bootstrapScripts: ['/test-client.js'],
    }
  );
  const reader = stream.getReader();
  try {
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      'Sign in to your store'
    );
    expect(mocks.connection).toHaveBeenCalledOnce();
  } finally {
    request.resolve();
    await stream.allReady;
    await reader.cancel();
  }
});
