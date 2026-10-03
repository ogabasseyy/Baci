import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eventPipelineChatCredentialPaths } from './event-pipeline-chat-credential-paths';
import { eventPipelineCoreCredentialPaths } from './event-pipeline-core-credential-paths';
import { eventPipelineImmediateOrderCredentialPaths } from './event-pipeline-immediate-order-credential-paths';
import { eventPipelineJumiaCredentialPaths } from './event-pipeline-jumia-credential-paths';
import { eventPipelineManualOrderDocumentCredentialPaths } from './event-pipeline-manual-order-document-credential-paths';
import { eventPipelineRedvaultCredentialPaths } from './event-pipeline-redvault-credential-paths';
import { eventPipelineRepairPickupCredentialPaths } from './event-pipeline-repair-pickup-credential-paths';
import { eventPipelineShippingCredentialPaths } from './event-pipeline-shipping-credential-paths';

const modulePath = resolve(
  process.cwd(),
  'src/lib/events/event-pipeline-boundary-manifest.ts'
);

describe('event pipeline credential-path authority', () => {
  it('pins every reviewed credential path, including compare preflight', async () => {
    expect(existsSync(modulePath), 'boundary manifest is missing').toBe(true);
    if (!existsSync(modulePath)) return;

    const { eventPipelineBoundaryManifest: manifest } = await import(
      /* @vite-ignore */ pathToFileURL(modulePath).href
    );

    expect(manifest.authority.credentialPaths).toEqual([
      ...eventPipelineCoreCredentialPaths,
      ...eventPipelineImmediateOrderCredentialPaths,
      ...eventPipelineJumiaCredentialPaths,
      ...eventPipelineRepairPickupCredentialPaths,
      ...eventPipelineRedvaultCredentialPaths,
      ...eventPipelineShippingCredentialPaths,
      ...eventPipelineChatCredentialPaths,
      ...eventPipelineManualOrderDocumentCredentialPaths,
    ]);
  });
});
