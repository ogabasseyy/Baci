import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { createPublicCartPolicy } from '../experience-verifier/public-cart-policy';
import { runPublicCartChannel } from './public-cart-channel';
import {
  cartId,
  fixture,
  merchantId,
  origin,
  productId,
} from './public-observation-fixture.test-support';

it('runs the browser worker over its framed host channel with a synthetic cart', async () => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tools/experience-runner/public-observation-worker.ts'],
    {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' },
      stdio: 'pipe',
    }
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4096);
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', resolve);
  });
  const cart = {
    cartId,
    merchantId,
    version: 1,
    lines: [{ item: { productId }, quantity: 1 }],
  };
  const checkout = {
    cartId,
    merchantId,
    cartVersion: 1,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    lines: [{ productId, variantId: null, quantity: 1, available: true }],
  };
  const policy = createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
  });
  try {
    child.stdin.write(
      `${JSON.stringify({ type: 'start', payload: fixture() })}\n`
    );
    const observation = await runPublicCartChannel({
      input: child.stdout,
      output: child.stdin,
      timeoutMs: 20000,
      session: async (request) => {
        if (!policy(request)) throw Error('DENIED');
        if (request.url.endsWith('/api/csrf'))
          return { status: 200, body: '{}' };
        return {
          status: 200,
          body: JSON.stringify(
            request.url.endsWith('/checkout')
              ? { snapshot: checkout }
              : { cart }
          ),
        };
      },
    });
    expect(await exited, stderr).toBe(0);
    expect(observation).toMatchObject({
      journey: {
        orderRequests: 0,
        paymentRequests: 0,
        steps: [
          { action: 'navigate' },
          { action: 'product' },
          { action: 'cart-add' },
          { action: 'cart-read' },
          { action: 'checkout-review' },
        ],
      },
    });
  } finally {
    child.kill('SIGKILL');
  }
}, 30000);
