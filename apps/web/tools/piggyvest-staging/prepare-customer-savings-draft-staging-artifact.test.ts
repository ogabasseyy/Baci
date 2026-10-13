import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareCustomerSavingsDraftStagingArtifact } from './prepare-customer-savings-draft-staging-artifact';

const requiredFunctions = [
  'api/webhooks/piggyvest',
  'api/storefront/customer/savings/drafts',
  'api/storefront/customer/savings/drafts/policy',
  'api/storefront/customer/savings/drafts/catalogue',
];

let directory: string;

async function buildOutput(config: Record<string, unknown>) {
  const output = join(directory, '.vercel/output');
  await mkdir(join(output, 'functions'), { recursive: true });
  for (const path of requiredFunctions)
    await mkdir(join(output, 'functions', `${path}.func`), { recursive: true });
  await writeFile(join(output, 'config.json'), JSON.stringify(config));
  return output;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'customer-draft-artifact-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('prepareCustomerSavingsDraftStagingArtifact', () => {
  it('prepends a deny rule while preserving the generated Next routing', async () => {
    const routes = [
      { src: '/existing-next-route', dest: '/existing-function' },
    ];
    const output = await buildOutput({ version: 3, routes });

    await prepareCustomerSavingsDraftStagingArtifact(output);

    const config = JSON.parse(
      await readFile(join(output, 'config.json'), 'utf8')
    );
    expect(config.routes).toEqual([
      {
        src: '/(?!api/webhooks/piggyvest$|api/storefront/customer/savings/drafts(?:/policy|/catalogue)?$).*',
        status: 404,
      },
      ...routes,
    ]);
  });

  it('rejects an artifact that omits a required existing Next route function', async () => {
    const output = await buildOutput({ version: 3, routes: [] });
    await rm(
      join(output, 'functions/api/storefront/customer/savings/drafts.func'),
      {
        recursive: true,
        force: true,
      }
    );

    await expect(
      prepareCustomerSavingsDraftStagingArtifact(output)
    ).rejects.toThrow('missing required function');
    expect(
      JSON.parse(await readFile(join(output, 'config.json'), 'utf8'))
    ).toEqual({
      version: 3,
      routes: [],
    });
  });

  it('rejects an artifact that would register a cron route', async () => {
    const output = await buildOutput({
      version: 3,
      crons: [{ path: '/api/cron/unrelated', schedule: '* * * * *' }],
    });

    await expect(
      prepareCustomerSavingsDraftStagingArtifact(output)
    ).rejects.toThrow('must not contain cron routes');
  });
});
