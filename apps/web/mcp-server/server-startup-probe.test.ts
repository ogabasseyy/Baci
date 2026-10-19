// @vitest-environment node
import { expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

it('refuses to listen when the worker capability probe fails', async () => {
  // A mis-issued worker JWT (bad signature, issuer, or project) passes
  // the offline shape check, so startup proves the whole chain with one
  // read-only RPC: the gateway-style 403 here must fail the boot before
  // the server serves traffic, failing the deploy's /health curl loop
  // instead of promoting a release whose carts are dead on arrival.
  const outcome = await mcpServerTestSupport
    .startMcpServerWithPostgrest({}, { workerRpcFails: true })
    .then(
      () => 'started',
      (error: unknown) => String(error)
    );
  expect(outcome).toContain('exited before startup');
  expect(outcome).toContain('capability');
}, 60000);
