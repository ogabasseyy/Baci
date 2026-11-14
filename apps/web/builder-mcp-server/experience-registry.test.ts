import { expect, it, vi } from 'vitest';
import { experienceToolPolicy } from '../src/lib/experience/tool-policy';
import {
  type ExperienceToolName,
  experienceToolInputs,
  experienceToolNames,
} from '../src/schemas/experience-tools';
import { experienceWireContracts } from '../tools/experience-runner/generate-tool-contracts';
import {
  experienceWireInputs,
  listedExperienceSchemas,
} from './experience-contracts';
import wire from './experience-contracts.json';
import { experienceToolDescriptions } from './experience-metadata';
import { registerBuilderTools } from './registry';

const id = '11111111-1111-4111-8111-111111111111';
it('guides status reconciliation after an indeterminate finalization response', () => {
  const description =
    experienceToolDescriptions.finalize_experience_build.description;
  expect(description).toContain('get_experience_operation');
  expect(description).toContain('same jobId');
  expect(description).toContain('do not assume failure');
  expect(description).toContain('background processing');
  expect(description).toContain('may still be queued');
});
it('guides localized commerce controls without replacing commerce operations', () => {
  const description =
    experienceToolDescriptions.get_experience_capabilities.description;
  expect(description).toContain('data-baci-commerce="add"');
  expect(description).toContain('data-baci-commerce="checkout"');
  expect(description).toContain('do not replace Baci commerce calls');
});
function server() {
  const registered = new Map<
    string,
    {
      config: Record<string, unknown>;
      handler: (input: unknown) => Promise<unknown>;
    }
  >();
  let list: (() => Promise<{ tools: Record<string, unknown>[] }>) | undefined;
  const mock = {
    registerTool: (
      n: string,
      c: Record<string, unknown>,
      h: (i: unknown) => Promise<unknown>
    ) => {
      registered.set(n, { config: c, handler: h });
    },
    server: {
      setRequestHandler: (_name: string, h: typeof list) => {
        list = h;
      },
    },
  };
  return { mock, registered, list: () => list?.() };
}
it('disabled discovery is the unchanged eight legacy tools; enabled schemas/policies equal runtime and generated wire', async () => {
  expect(wire).toEqual(experienceWireContracts());
  for (const enabled of [false, true]) {
    const s = server();
    registerBuilderTools(s.mock as never, {
      executeBuilderTool: vi.fn(),
      ...(enabled ? { experience: { enabled: true as const } } : {}),
    });
    const tools = (await s.list())?.tools ?? [];
    expect(tools).toHaveLength(enabled ? 22 : 8);
    for (const name of experienceToolNames) {
      const tool = tools.find((t) => t.name === name);
      if (!enabled) {
        expect(tool).toBeUndefined();
        continue;
      }
      expect(tool).toMatchObject({
        ...listedExperienceSchemas(name),
        annotations: experienceToolPolicy[name].annotations,
        securitySchemes: experienceToolPolicy[name].securitySchemes,
      });
      expect((tool?.inputSchema as { type: string }).type).toBe('object');
    }
  }
  expect(experienceToolPolicy.preview_experience.annotations.readOnlyHint).toBe(
    false
  );
});
it('native evidence adapters return image content and never attach arbitrary experience source to cached widgets', async () => {
  const s = server();
  const readImage = vi.fn(async () => ({
    type: 'image' as const,
    mimeType: 'image/png',
    data: 'synthetic',
  }));
  registerBuilderTools(s.mock as never, {
    bearerToken: 'synthetic.token',
    experience: { enabled: true, readImage },
    executeBuilderTool: async (_token, name) =>
      name === 'read_experience_evidence'
        ? { status: 'ok', value: { evidenceId: id } }
        : {
            status: 'error',
            code: 'NOT_FOUND',
            error: 'Experience request unavailable.',
          },
  });
  const result = await s.registered
    .get('read_experience_evidence')
    ?.handler({ storefrontId: id, evidenceId: id });
  expect(result).toMatchObject({
    content: expect.arrayContaining([
      { type: 'image', mimeType: 'image/png', data: 'synthetic' },
    ]),
  });
  expect(readImage).toHaveBeenCalledWith('synthetic.token', id, undefined);
  for (const name of experienceToolNames)
    expect(JSON.stringify(s.registered.get(name)?.config._meta)).not.toContain(
      'ui/resourceUri'
    );
});
it('strict schemas reject model approval flags, caller URLs and post-base64 chunk overflow', () => {
  expect(
    experienceToolInputs.publish_experience.safeParse({
      storefrontId: id,
      buildId: id,
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
      idempotencyKey: id,
      approved: true,
    }).success
  ).toBe(false);
  expect(
    experienceToolInputs.read_experience_evidence.safeParse({
      storefrontId: id,
      evidenceId: id,
      url: 'https://evil.test',
    }).success
  ).toBe(false);
  expect(
    experienceToolInputs.write_experience_chunk.safeParse({
      storefrontId: id,
      uploadId: id,
      path: 'app.tsx',
      offset: 0,
      bytesBase64: 'a'.repeat(43696),
      chunkDigest: 'a'.repeat(64),
    }).success
  ).toBe(false);
});

it('experience auth failures carry reconnect scope challenges without exposing tokens', async () => {
  const { experienceMcpToolResult } = await import('./experience-tool-result');
  const result = await experienceMcpToolResult('publish_experience', {
    status: 'error',
    code: 'INSUFFICIENT_SCOPE',
    error: 'Experience request unavailable.',
  });
  expect(result._meta?.['mcp/www_authenticate']).toEqual([
    expect.stringContaining('scope="storefront.read storefront.publish"'),
  ]);
  expect(JSON.stringify(result)).not.toContain('synthetic.outer');
});

it('rejects unknown root properties in every converted tool schema', () => {
  const digest = 'a'.repeat(64);
  const path = 'src/Experience.tsx';
  const build = { buildId: id };
  const job = { jobId: id };
  const upload = { uploadId: id };
  const retry = { idempotencyKey: id };
  const evidence = { evidenceId: id };
  const lifecycle = {
    ...build,
    ...retry,
    expectedDraftVersion: 0,
    expectedPublishedVersion: 0,
  };
  const inputs = {
    get_experience_capabilities: {},
    read_experience: {
      operation: 'read',
      artifactId: id,
      path,
      byteOffset: 0,
      maxBytes: 10,
    },
    begin_experience_upload: {
      manifest: {
        format: 'baci.experience/v2',
        runtime: 'react-browser-sandbox/v1',
        sdkVersion: 'commerce-bridge/v1',
        entry: path,
        files: [{ path, content: 'synthetic' }],
        packages: [{ name: 'react', versionRef: 'platform-pinned' }],
        routes: [{ path: '/', view: 'home' }],
        assets: [],
        capabilities: ['catalog.read'],
      },
      files: { files: [{ path, bytes: 9, digest }] },
    },
    write_experience_chunk: {
      ...upload,
      path,
      offset: 0,
      bytesBase64: 'YQ==',
      chunkDigest: digest,
    },
    finalize_experience_upload: upload,
    build_experience: { artifactId: id, ...retry },
    get_experience_operation: job,
    read_experience_performance: build,
    finalize_experience_build: { ...job, ...retry },
    preview_experience: { ...build, ...retry, routeId: '/' },
    apply_experience: { ...build, ...retry, ...evidence, expectedVersion: 0 },
    publish_experience: lifecycle,
    rollback_experience: lifecycle,
    read_experience_evidence: evidence,
  } satisfies Record<ExperienceToolName, object>;
  for (const name of experienceToolNames) {
    const input = { storefrontId: id, ...inputs[name] };
    expect(experienceToolInputs[name].safeParse(input).success, name).toBe(
      true
    );
    const schema = experienceWireInputs[name];
    expect(schema.safeParse(input).success, name).toBe(true);
    expect(schema.safeParse({ ...input, unexpected: true }).success, name).toBe(
      false
    );
  }
});
