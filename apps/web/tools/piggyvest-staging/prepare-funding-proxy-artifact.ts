import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';
import { customerFundingRoutes } from './customer-funding-routes';

export async function prepareFundingProxyArtifact(input: {
  output: string;
  receiverSha256: string;
  functionConfigSha256: string;
}): Promise<void> {
  const receiver = join(input.output, 'functions/api/webhooks/piggyvest.func');
  for (const [name, expected] of [
    ['index.mjs', input.receiverSha256],
    ['.vc-config.json', input.functionConfigSha256],
  ]) {
    if (!/^[a-f0-9]{64}$/.test(expected))
      throw new Error('Invalid receiver pin');
    const actual = createHash('sha256')
      .update(await readFile(join(receiver, name)))
      .digest('hex');
    if (actual !== expected)
      throw new Error('Receiver preservation check failed');
  }
  const configPath = join(input.output, 'config.json');
  const config: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  const baseline = {
    version: 3,
    routes: [...customerDraftProxyRoutes(), { handle: 'filesystem' }],
  };
  if (!isDeepStrictEqual(config, baseline))
    throw new Error('Unexpected staging route baseline');
  const funding = customerFundingRoutes().proxyRoutes;
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: 3,
        routes: [
          ...customerDraftProxyRoutes(),
          ...funding,
          ...funding.map(({ src }) => ({ src, status: 405 })),
          { handle: 'filesystem' },
        ],
      },
      null,
      2
    )}\n`
  );
}
