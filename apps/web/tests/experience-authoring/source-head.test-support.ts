import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

type Call = (
  name: string,
  input: Record<string, unknown>
) => Promise<{ value?: Record<string, unknown> }>;

export async function rehearseSourceHead(
  call: Call,
  storefrontId: string,
  uploaded: Record<string, unknown> | undefined,
  initialSource: string
) {
  const { artifactId, sourceDigest } = uploaded ?? {};
  const adopted = await call('read_experience', {
    storefrontId,
    operation: 'adopt-upload',
    artifactId,
    baseDigest: sourceDigest,
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  });
  expect(adopted).toMatchObject({
    status: 'ok',
    value: { artifactId, version: 1, conflict: false },
  });
  const readHead = () =>
    call('read_experience', { storefrontId, operation: 'head' });
  expect(await readHead()).toMatchObject({
    status: 'ok',
    value: {
      artifactId,
      sourceDigest,
      version: 1,
      entry: 'app.tsx',
      files: ['app.tsx'],
    },
  });
  const revisedSource = initialSource.replace(
    'Synthetic MCP storefront',
    'Orbit QA Collection'
  );
  const patch = {
    storefrontId,
    operation: 'patch',
    baseDigest: sourceDigest,
    expectedVersion: 1,
    files: [{ path: 'app.tsx', content: revisedSource }],
  };
  const revised = await call('read_experience', {
    ...patch,
    idempotencyKey: randomUUID(),
  });
  expect(revised).toMatchObject({
    status: 'ok',
    value: { version: 2, conflict: false },
  });
  const updatedArtifactId = revised.value?.artifactId;
  expect(updatedArtifactId).not.toBe(artifactId);
  const head = await readHead();
  expect(head).toMatchObject({
    status: 'ok',
    value: {
      artifactId: updatedArtifactId,
      version: 2,
      sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      entry: 'app.tsx',
      files: ['app.tsx'],
    },
  });
  expect(head.value?.sourceDigest).not.toBe(sourceDigest);
  expect(
    await call('read_experience', {
      ...patch,
      idempotencyKey: randomUUID(),
    })
  ).toMatchObject({ status: 'ok', value: { version: 2, conflict: true } });
  expect(await readHead()).toEqual(head);
  expect(
    await call('read_experience', {
      storefrontId,
      operation: 'read',
      artifactId: updatedArtifactId,
      path: 'app.tsx',
      byteOffset: 0,
      maxBytes: 4096,
    })
  ).toMatchObject({
    status: 'ok',
    value: { content: revisedSource, nextCursor: null },
  });
  return updatedArtifactId;
}
