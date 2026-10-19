import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHar } from './merchant-image-pilot-settings-har.mjs';

function harWithUa(dir, name, ua) {
  const path = join(dir, name);
  return writeFile(
    path,
    JSON.stringify({
      log: {
        entries: [
          {
            request: { headers: [{ name: 'User-Agent', value: ua }] },
            response: { status: 200 },
          },
        ],
        pages: [],
      },
    })
  ).then(() => path);
}

async function browserFailures(harPath) {
  const failures = [];
  await checkHar(
    {
      'expect-chrome-major': '154',
      'expect-connectivity': 'native',
      'expect-dpr': '2',
      'expect-iterations': '1',
      'expect-route': '/pilot-lab/store/ogabassey',
      'expect-viewport': '375x667',
      har: harPath,
      screenshot: join(tmpdir(), 'pilot-har-browser-missing.png'),
    },
    () => undefined,
    (name, detail) => failures.push(`${name}: ${detail}`),
    () => undefined,
    {}
  );
  return failures.filter((failure) => failure.startsWith('har.browser:'));
}

describe('merchant-image-pilot-settings har.browser', () => {
  it('passes a full-Chrome UA', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-har-browser-'));
    const harPath = await harWithUa(
      dir,
      'full.har',
      'Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36'
    );
    await expect(browserFailures(harPath)).resolves.toEqual([]);
  });

  it('rejects chrome-headless-shell evidence', async () => {
    // The shell UA contains the Chrome/<major>. token, so a bare
    // substring check would certify shell evidence as full Chrome.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-har-browser-'));
    const harPath = await harWithUa(
      dir,
      'shell.har',
      'Mozilla/5.0 HeadlessChrome/154.0.0.0 Safari/537.36'
    );
    const failures = await browserFailures(harPath);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/headless-shell/);
  });
});
