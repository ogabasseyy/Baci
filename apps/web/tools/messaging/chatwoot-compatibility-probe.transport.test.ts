import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { ChatwootProbeInput } from './chatwoot-compatibility-probe';
import { runChatwootIsolationProbe } from './chatwoot-compatibility-probe';

const input: ChatwootProbeInput = {
  baseUrl: 'http://127.0.0.1:3000',
  accountAId: '11',
  accountAToken: 'TOKEN-A-SENTINEL',
  accountBId: '22',
  accountBToken: 'TOKEN-B-SENTINEL',
  conversationId: '123',
};

it.each([
  'token\rvalue',
  'token\nvalue',
  'token\0value',
  'token\u007fvalue',
])('rejects token control characters before sending requests', async (token) => {
  const fetcher = vi.fn();
  const result = await runChatwootIsolationProbe(
    { ...input, accountAToken: token },
    fetcher
  );

  expect(result).toMatchObject({
    decision: 'unqualified',
    check: 'unknown',
    outcome: 'invalid-configuration',
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('sends loopback probe requests directly when Node environment proxy mode is enabled', async () => {
  const apiRequests: string[] = [];
  let proxyRequests = 0;
  const api = createServer((request, response) => {
    apiRequests.push(`${request.url} ${request.headers.api_access_token}`);
    const status =
      request.url === '/api/v1/accounts/22/conversations' ||
      request.headers.api_access_token === input.accountAToken
        ? 200
        : 404;
    response.writeHead(status).end();
  });
  const proxy = createServer((_request, response) => {
    proxyRequests += 1;
    response.writeHead(200).end();
  });

  api.listen(0, '127.0.0.1');
  proxy.listen(0, '127.0.0.1');
  await Promise.all([once(api, 'listening'), once(proxy, 'listening')]);
  try {
    const apiAddress = api.address();
    const proxyAddress = proxy.address();
    if (!apiAddress || typeof apiAddress === 'string')
      throw Error('no API port');
    if (!proxyAddress || typeof proxyAddress === 'string')
      throw Error('no proxy port');

    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      'chatwoot-compatibility-probe.ts'
    );
    const tsxPackage = createRequire(import.meta.url).resolve(
      'tsx/package.json'
    );
    const tsxCli = join(dirname(tsxPackage), 'dist', 'cli.mjs');
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (
        key.startsWith('CHATWOOT_PROBE_') ||
        /^(?:https?|all)_proxy$/i.test(key) ||
        /^(?:no)_proxy$/i.test(key)
      )
        delete environment[key];
    }
    const proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
    Object.assign(environment, {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: proxyUrl,
      NO_PROXY: '',
      no_proxy: '',
      CHATWOOT_PROBE_URL: `http://127.0.0.1:${apiAddress.port}`,
      CHATWOOT_PROBE_ACCOUNT_A_ID: input.accountAId,
      CHATWOOT_PROBE_ACCOUNT_A_TOKEN: input.accountAToken,
      CHATWOOT_PROBE_ACCOUNT_B_ID: input.accountBId,
      CHATWOOT_PROBE_ACCOUNT_B_TOKEN: input.accountBToken,
      CHATWOOT_PROBE_CONVERSATION_ID: input.conversationId,
    });

    const result = await new Promise<{
      status: number | null;
      stderr: string;
      stdout: string;
      error?: Error;
    }>((resolve) => {
      const child = spawn(
        process.execPath,
        ['--use-env-proxy', tsxCli, sourcePath],
        {
          cwd: process.cwd(),
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error: Error) =>
        resolve({ status: null, stderr, stdout, error })
      );
      child.on('close', (status: number | null) =>
        resolve({ status, stderr, stdout })
      );
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      killTimer.unref();
      child.once('close', () => clearTimeout(killTimer));
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      decision: 'unqualified',
      check: 'observed-status',
      outcome: 'cross-token-status-404-after-positive-controls',
    });
    expect(proxyRequests).toBe(0);
    expect(apiRequests).toEqual([
      `/api/v1/accounts/22/conversations ${input.accountBToken}`,
      `/api/v1/accounts/11/conversations/123 ${input.accountAToken}`,
      `/api/v1/accounts/11/conversations/123 ${input.accountBToken}`,
    ]);
  } finally {
    api.close();
    proxy.close();
    await Promise.all([once(api, 'close'), once(proxy, 'close')]);
  }
}, 30_000);
