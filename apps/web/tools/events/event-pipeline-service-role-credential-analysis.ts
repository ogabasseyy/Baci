import { createHash } from 'node:crypto';
import ts from '@typescript/typescript6';
import { parseEventPipelineTypeScriptSource } from '../../src/lib/events/event-pipeline-typescript-source';
import { resolveLexicalString } from './analytics-delivery-static-string';
import { isTestSourcePath } from './event-pipeline-source-path';

type CredentialReaderLedgers = {
  approvedTask6ReaderHashes: Readonly<Record<string, string>>;
  preExistingReaderHashes: Readonly<Record<string, string>>;
  testSupportReaderHashes: Readonly<Record<string, string>>;
};

const defaultLedgers: CredentialReaderLedgers = {
  approvedTask6ReaderHashes: {
    'apps/web/src/lib/supabase/service.ts':
      '6754dc6f3381be4653abc91e32e65c741172563db570b81c4e820190384f0e05',
  },
  // These are pre-existing factory, worker, or route readers. They are not part
  // of the temporary three-edge Task 6 analytics exception. Tracked operational
  // scripts and MCP utilities are recorded here too, as pre-existing authority.
  preExistingReaderHashes: {
    'apps/web/mcp-server/migrate_images.ts':
      'bd69a87ccb7c68ecef2a49eaaf059465cef2b0a5de45a2dab9bc988381615bd7',
    'apps/web/mcp-server/server.ts':
      'b616e48f8a83fd45ae7d12337398a2755d04b4abe929276ac3df2ebfb16b76fe',
    'apps/web/scripts-tmp/bulk-fix-macbooks.ts':
      'b68336dba5c2cb670b48599657f635870aa75786d243fe65568c080ddf82372d',
    'apps/web/scripts-tmp/check-blog-images.ts':
      '1fb9446df0f9bdac7c56423ec18b10c0dbaf0c3990aefa26762b944f43146dc5',
    'apps/web/scripts-tmp/check-cdn-access.ts':
      'a2d1896f28a50ba065b33f2b0666116f77bfd46a8b5f15110446550bfc29b647',
    'apps/web/scripts-tmp/check-macbooks.ts':
      '84399ebbe739c46d603fea9e141f1ca57e828271c446513985af20e2a358b6ca',
    'apps/web/scripts-tmp/cleanup-and-research.ts':
      '1a977ce5fcb75dcdfca88a7a7001717bfcca1171172275688f5277b812ae5fe3',
    'apps/web/scripts-tmp/fix-macbook-image.ts':
      '3ec4f17fdc221b1014d611c74dee1249a45cb8b75480c5dd21bf5eb16dffbb05',
    'apps/web/scripts-tmp/list-missing-parents.ts':
      '00c181f224df20546ce0bc2237941c5f93f5a5553c33e2536f7389b7fce23b31',
    'apps/web/scripts-tmp/list-remaining-parents.ts':
      'e4907b2c49facff84cce3e84f24e1e226c8d4a010e3603cc0028d87071d60e9c',
    'apps/web/scripts-tmp/rename-overwatch.ts':
      '59df1361ab27c749d07870397f2b371a2545f44f2afff792ec351160ff4b07cf',
    'apps/web/scripts-tmp/set-ogabassey-favicon.ts':
      'ac43f9ca8a769aaa326611369fc65483abcf549fe08b5c4b2cf8383b1e08485e',
    'apps/web/scripts-tmp/smart-fix-blog-images.ts':
      'a3dc962c3c49f29718be13c72d1268a62081e9dbcaea686d64761d861decb5e0',
    'apps/web/scripts-tmp/sync-gaming-variants.ts':
      '12718e1eeb83c1cfa237341c1a52bdabf0258e3d93822c84995ab09ce814ebcb',
    'apps/web/scripts-tmp/update-blog-image.ts':
      'f7218389f78d41b9075e6594419fb218b0a5beaafc29f7aec5d92f266a7014f7',
    'apps/web/scripts-tmp/update-cdn-urls.ts':
      '734059ab6295a9ad5585e157755df1276b968fb06834c84c2b76520c1a3eead1',
    'apps/web/scripts-tmp/update-phase1-parents.ts':
      '653955c1048c50365045426adbfe2f4b28b03fcae479aadf045f139986e009a6',
    'apps/web/scripts-tmp/update-phase2-parents.ts':
      'e834e6d5aedb0b5e8c76784c26cf6a08f259d536c893476e7e55c617159fbc24',
    'apps/web/scripts-tmp/upload-batch-a-part2.ts':
      '93663105b1118b011ec9c4dd16d86629c2cbc0f7898a64cf810a6f228d6eac3f',
    'apps/web/scripts-tmp/upload-batch-a.ts':
      '50ea52ec3d47b6c8afb6cf36c2273bbd6c203bc2f9d3af60f00c96c94768560f',
    'apps/web/scripts-tmp/upload-game-covers.ts':
      '5a05fb0b5bcfb445c8527cce70d02912fb050db2fb98604d91c2d43b9c566377',
    'apps/web/src/app/api/ai-jobs/worker/route.ts':
      '3cd51c9f0c4aeba362afd3d37e1a4b2d29107bedb6bdf2f75c9860cdc28fa42a',
    'apps/web/src/app/api/shipping/self-fulfill/route.ts':
      'd86b574dac4cf45c72cc54eb7ad1178af4bbb6064a5a3e73e9309ea73d20a221',
    'apps/web/src/app/api/shipping/webhooks/[provider]/route.ts':
      '2a2713042ae099e9deb7ac4be9e05631fbf72d18789689a26fa0e4896f2189d5',
    'apps/web/src/env.ts':
      '6a00a9893d24ded63fa00969196dd9c663fcf4fa0f51535a65119f8c5eab0789',
    'apps/web/src/scripts/process-ai-storefront-jobs.ts':
      '47bea3bc3ac77a939febb07b99c4ec4edf6f16f33f310dddd23ec2a4cbe2c0ad',
    'vps-workers/jobs/cleanup-agentic-request-records.mjs':
      '29d02f20900fe0d476d57b2620dd324a4830ff200a66fc3b4454aaf48047dd19',
    'vps-workers/jobs/cleanup-legacy-expense-receipts.mjs':
      '642437579009d3bfcf70dba0ed26b67e49f17eb4ed65f16cf6d6924bc80d4bd4',
    'vps-workers/jobs/cleanup-private-expense-receipts.mjs':
      'fa73f2cb71434ab15e08a49326f52cefb3ab02b262b8ed6cb8d5b0175dbd60e5',
    'vps-workers/jobs/cleanup-import-uploads.mjs':
      '00c9de97809d2ba2280276f875506f62a56fea4c4cf89d09ade132df3105a385',
    'vps-workers/jobs/cleanup-push-tokens.mjs':
      'db221f22d082dc352b274edd04445f5f7c1cf03f21c207483dc8d1dfb90b677c',
    'vps-workers/jobs/push-receipts.mjs':
      '53fdf8d8b8b3b897c533d150ddbdbfa8c250df465cca6f8eea7fbe8806a4b96c',
    'vps-workers/jobs/supabase-retention-cleanup.mjs':
      'fd260d7c9e8fa080ed938d659e009402554bbcf2915ad26823daa97b3d0f9595',
    'vps-workers/jobs/sync-gigl-service-centres.mjs':
      'f25ef9f60e7297033e1d8b42f71ceba82cee4fe42c7cbce1b201f5ff8f8e72e8',
    'scripts-tmp/check-cdn-access.ts':
      'a2d1896f28a50ba065b33f2b0666116f77bfd46a8b5f15110446550bfc29b647',
    'scripts-tmp/list-missing-parents.ts':
      '00c181f224df20546ce0bc2237941c5f93f5a5553c33e2536f7389b7fce23b31',
    'scripts-tmp/list-remaining-parents.ts':
      'e4907b2c49facff84cce3e84f24e1e226c8d4a010e3603cc0028d87071d60e9c',
    'scripts-tmp/sync-gaming-variants.ts':
      '12718e1eeb83c1cfa237341c1a52bdabf0258e3d93822c84995ab09ce814ebcb',
    'scripts-tmp/update-cdn-urls.ts':
      '734059ab6295a9ad5585e157755df1276b968fb06834c84c2b76520c1a3eead1',
    'scripts-tmp/update-phase1-parents.ts':
      '653955c1048c50365045426adbfe2f4b28b03fcae479aadf045f139986e009a6',
    'scripts-tmp/update-phase2-parents.ts':
      'e834e6d5aedb0b5e8c76784c26cf6a08f259d536c893476e7e55c617159fbc24',
    'scripts-tmp/upload-game-covers.ts':
      'c54726f6a965a6f318d36d6168e5528cd3722f5db30feff63492ba9d0a482738',
    'scripts/backfill-feed-images.ts':
      '20a87b3ad4b928ac65efc9d39b0b1ad3f8d1e944c56ac13dc6918baafe1195c6',
  },
  testSupportReaderHashes: {
    'apps/web/src/lib/events/event-pipeline-service-role-test-client.ts':
      '7c4706a553218e97f1d150f4ee9ea6f82dd19678c9036f2de3aae5687e866b84',
  },
};

function readsCredential(path: string, source: string): boolean {
  const file = parseEventPipelineTypeScriptSource(path, source);
  const credentialNames = new Set([
    'SUPABASE_ADS_CREDENTIAL_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  const key = (expression: ts.Expression | undefined, at: ts.Node) =>
    credentialNames.has(resolveLexicalString(expression, file, at) ?? '');
  let found = false;
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      credentialNames.has(node.name.text)
    ) {
      found = true;
    } else if (
      ts.isElementAccessExpression(node) &&
      key(node.argumentExpression, node)
    ) {
      found = true;
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Reflect' &&
      node.expression.name.text === 'get' &&
      key(node.arguments[1], node)
    ) {
      found = true;
    } else if (ts.isBindingElement(node)) {
      const property = node.propertyName ?? node.name;
      if (
        (ts.isIdentifier(property) && credentialNames.has(property.text)) ||
        (ts.isComputedPropertyName(property) && key(property.expression, node))
      )
        found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

function findings(
  sources: ReadonlyMap<string, string>,
  ledgers: CredentialReaderLedgers = defaultLedgers
): string[] {
  const results: string[] = [];
  const categories = [
    ['Task 6 approved', ledgers.approvedTask6ReaderHashes],
    ['pre-existing', ledgers.preExistingReaderHashes],
    ['test-support', ledgers.testSupportReaderHashes],
  ] as const;
  const classified = new Map<string, { category: string; hash: string }>();
  for (const [category, ledger] of categories)
    for (const [path, hash] of Object.entries(ledger))
      classified.set(path, { category, hash });
  for (const [path, source] of sources) {
    if (isTestSourcePath(path) || !readsCredential(path, source)) continue;
    const record = classified.get(path);
    if (!record) {
      results.push(
        `${path}: unclassified production service-role credential read`
      );
      continue;
    }
    const actual = createHash('sha256').update(source).digest('hex');
    if (actual !== record.hash)
      results.push(
        `${path}: ${record.category} service-role credential reader hash drift`
      );
  }
  for (const [path, record] of classified) {
    const source = sources.get(path);
    if (!source) {
      results.push(
        `${path}: classified service-role credential reader is missing`
      );
    } else if (!readsCredential(path, source)) {
      results.push(
        `${path}: classified service-role credential read was removed; retire its ledger entry`
      );
    } else {
      const actual = createHash('sha256').update(source).digest('hex');
      if (actual !== record.hash)
        results.push(
          `${path}: ${record.category} service-role credential reader hash drift`
        );
    }
  }
  return [...new Set(results)].sort();
}

export const serviceRoleCredentialAuthority = {
  findings,
  ledgers: defaultLedgers,
  readsCredential,
} as const;
