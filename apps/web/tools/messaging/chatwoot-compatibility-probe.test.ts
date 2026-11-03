import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
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

function response(status: number): Response {
  return new Response('PRIVATE-RESPONSE-SENTINEL', { status });
}

describe('runChatwootIsolationProbe', () => {
  it('runs from a path with spaces and # and reports missing config without networking', async () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      'chatwoot-compatibility-probe.ts'
    );
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'chatwoot probe #')
    );
    const copiedScript = join(temporaryDirectory, 'probe # copy.ts');
    const importWrapper = join(temporaryDirectory, 'import wrapper.ts');
    const tsxPackage = createRequire(import.meta.url).resolve(
      'tsx/package.json'
    );
    const tsxCli = join(dirname(tsxPackage), 'dist', 'cli.mjs');
    try {
      await copyFile(sourcePath, copiedScript);
      const environment = { ...process.env };
      for (const key of Object.keys(environment)) {
        if (key.startsWith('CHATWOOT_PROBE_')) delete environment[key];
      }
      const result = spawnSync(process.execPath, [tsxCli, copiedScript], {
        cwd: process.cwd(),
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        decision: 'unqualified',
        check: 'unknown',
        outcome: 'invalid-configuration',
      });
      expect(result.stderr).toBe('');

      await writeFile(
        importWrapper,
        "import { pathToFileURL } from 'node:url';\nvoid import(pathToFileURL(process.argv[2]!).href);\n"
      );
      const imported = spawnSync(
        process.execPath,
        [tsxCli, importWrapper, copiedScript],
        {
          cwd: process.cwd(),
          env: environment,
          encoding: 'utf8',
          timeout: 10_000,
        }
      );
      expect(imported.error).toBeUndefined();
      expect(imported.status, imported.stderr).toBe(0);
      expect(imported.stdout).toBe('');
      expect(imported.stderr).toBe('');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses the documented read-only endpoint with both credentials and confirms only observed denial', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(404));

    const result = await runChatwootIsolationProbe(input, fetcher);

    expect(result).toEqual({
      decision: 'unqualified',
      check: 'observed-denial',
      outcome: 'A-200-B-403-or-404',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url.toString()).toBe(
        'http://127.0.0.1:3000/api/v1/accounts/11/conversations/123'
      );
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      api_access_token: input.accountAToken,
    });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      api_access_token: input.accountBToken,
    });
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.2:3000',
    'http://user:pass@127.0.0.1:3000',
    'http://127.0.0.1:3000/?redirect=1',
    '',
  ])('refuses non-approved loopback URL %s without a request', async (baseUrl) => {
    const fetcher = vi.fn();
    const result = await runChatwootIsolationProbe(
      { ...input, baseUrl },
      fetcher
    );
    expect(result.outcome).toBe('invalid-configuration');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('accepts literal loopback host %s', async (baseUrl) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(403));
    const result = await runChatwootIsolationProbe(
      { ...input, baseUrl },
      fetcher
    );
    expect(result.check).toBe('observed-denial');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refuses missing, identical-account, or identical-token configuration before network access', async () => {
    const fetcher = vi.fn();
    const cases = [
      { ...input, accountAId: '' },
      { ...input, accountBId: input.accountAId },
      { ...input, accountBToken: input.accountAToken },
    ];
    for (const candidate of cases) {
      await expect(
        runChatwootIsolationProbe(candidate, fetcher)
      ).resolves.toMatchObject({
        check: 'unknown',
        outcome: 'invalid-configuration',
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    200, 301, 302, 401, 429, 500,
  ])('keeps B status %s unknown', async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(status));
    await expect(
      runChatwootIsolationProbe(input, fetcher)
    ).resolves.toMatchObject({
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'unexpected-response',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps A baseline failures and request exceptions unknown and does not leak response data or tokens', async () => {
    const rejected = vi.fn().mockResolvedValue(response(403));
    const failed = vi
      .fn()
      .mockRejectedValue(new Error('TOKEN-A-SENTINEL PRIVATE RESPONSE BODY'));
    const baseline = await runChatwootIsolationProbe(input, rejected);
    const requestFailure = await runChatwootIsolationProbe(input, failed);
    const serialized = JSON.stringify([baseline, requestFailure]);
    expect(baseline.outcome).toBe('unexpected-response');
    expect(requestFailure.outcome).toBe('request-failed');
    expect(serialized).not.toContain('TOKEN-A-SENTINEL');
    expect(serialized).not.toContain('PRIVATE');
  });
});
