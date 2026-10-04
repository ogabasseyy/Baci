import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REQUIRED_FUNCTIONS = [
  'api/webhooks/piggyvest',
  'api/storefront/customer/savings/drafts',
  'api/storefront/customer/savings/drafts/policy',
  'api/storefront/customer/savings/drafts/catalogue',
];
const DENY_NON_STAGING_ROUTE =
  '/(?!api/webhooks/piggyvest$|api/storefront/customer/savings/drafts(?:/policy|/catalogue)?$).*';

type BuildOutputConfig = {
  version: 3;
  routes?: unknown[];
  crons?: unknown;
  [key: string]: unknown;
};

function parseConfig(value: string): BuildOutputConfig {
  const config: unknown = JSON.parse(value);
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    !('version' in config) ||
    config.version !== 3
  )
    throw new Error('Build output config must use version 3');
  if ('routes' in config && !Array.isArray(config.routes))
    throw new Error('Build output routes must be an array');
  return config as BuildOutputConfig;
}

async function assertRequiredFunctions(output: string): Promise<void> {
  for (const functionPath of REQUIRED_FUNCTIONS) {
    try {
      const metadata = await stat(
        join(output, 'functions', `${functionPath}.func`)
      );
      if (!metadata.isDirectory()) throw new Error();
    } catch {
      throw new Error(
        `Build output missing required function: ${functionPath}`
      );
    }
  }
}

export async function prepareCustomerSavingsDraftStagingArtifact(
  output: string
): Promise<void> {
  const configPath = join(output, 'config.json');
  const config = parseConfig(await readFile(configPath, 'utf8'));
  if (Array.isArray(config.crons) && config.crons.length > 0)
    throw new Error('Staging artifact must not contain cron routes');
  if ('crons' in config && !Array.isArray(config.crons))
    throw new Error('Staging artifact must not contain cron routes');
  await assertRequiredFunctions(output);
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        routes: [
          { src: DENY_NON_STAGING_ROUTE, status: 404 },
          ...(config.routes ?? []),
        ],
      },
      null,
      2
    )}\n`
  );
}
