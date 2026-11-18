import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { expect, it } from 'vitest';
import {
  experienceToolInputs,
  experienceToolNames,
  isExperienceTool,
} from './experience-tools';

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);
const store = { storefrontId: id };
const read = {
  ...store,
  operation: 'read',
  artifactId: id,
  path: 'src/App.tsx',
  byteOffset: 0,
  maxBytes: EXPERIENCE_LIMITS.chunkBytes,
};
const patch = {
  ...store,
  operation: 'patch',
  baseDigest: digest,
  expectedVersion: 0,
  files: [{ path: 'src/App.tsx', content: 'synthetic' }],
  idempotencyKey: id,
};
const adopt = {
  ...store,
  operation: 'adopt-upload',
  artifactId: id,
  baseDigest: digest,
  expectedVersion: 0,
  idempotencyKey: id,
};
it('admits each source operation and rejects mixed, unsafe and out-of-budget inputs', () => {
  for (const valid of [read, patch, adopt])
    expect(experienceToolInputs.read_experience.safeParse(valid).success).toBe(
      true
    );
  for (const invalid of [
    { ...read, operation: 'unknown' },
    { ...read, approved: true },
    { ...read, byteOffset: -1 },
    { ...read, byteOffset: 1.5 },
    { ...read, maxBytes: 0 },
    { ...read, maxBytes: EXPERIENCE_LIMITS.chunkBytes + 1 },
    { ...read, path: '../private' },
    { ...read, files: patch.files },
    { ...patch, files: [] },
    {
      ...patch,
      files: Array.from(
        { length: EXPERIENCE_LIMITS.files + 1 },
        () => patch.files[0]
      ),
    },
    {
      ...patch,
      files: [
        {
          path: 'App.tsx',
          content: 'x'.repeat(EXPERIENCE_LIMITS.fileBytes + 1),
        },
      ],
    },
    { ...adopt, expectedVersion: -1 },
    { ...adopt, baseDigest: 'bad' },
  ])
    expect(
      experienceToolInputs.read_experience.safeParse(invalid).success
    ).toBe(false);
  expect(
    experienceToolInputs.read_experience.safeParse({
      ...patch,
      files: [
        { path: 'App.tsx', content: 'x'.repeat(EXPERIENCE_LIMITS.fileBytes) },
      ],
    }).success
  ).toBe(true);
});
it('bounds chunk encoding and strictly validates its metadata', () => {
  const chunk = {
    ...store,
    uploadId: id,
    path: 'App.tsx',
    offset: 0,
    bytesBase64: Buffer.alloc(EXPERIENCE_LIMITS.chunkBytes).toString('base64'),
    chunkDigest: digest,
  };
  expect(
    experienceToolInputs.write_experience_chunk.safeParse(chunk).success
  ).toBe(true);
  for (const invalid of [
    { ...chunk, bytesBase64: '' },
    { ...chunk, bytesBase64: 'abc' },
    { ...chunk, bytesBase64: 'a===' },
    { ...chunk, bytesBase64: '!!!!' },
    { ...chunk, bytesBase64: `${chunk.bytesBase64}AAAA` },
    { ...chunk, offset: -1 },
    { ...chunk, offset: 0.5 },
    { ...chunk, uploadId: 'bad' },
    { ...chunk, chunkDigest: 'bad' },
    { ...chunk, extra: true },
  ])
    expect(
      experienceToolInputs.write_experience_chunk.safeParse(invalid).success
    ).toBe(false);
});
it.each([
  'publish_experience',
  'rollback_experience',
] as const)('%s requires exact nonnegative integer versions and opaque identifiers', (name) => {
  const lifecycle = {
    ...store,
    buildId: id,
    expectedDraftVersion: 0,
    expectedPublishedVersion: 0,
    idempotencyKey: id,
  };
  expect(experienceToolInputs[name].safeParse(lifecycle).success).toBe(true);
  for (const invalid of [
    { ...lifecycle, expectedDraftVersion: -1 },
    { ...lifecycle, expectedPublishedVersion: -1 },
    { ...lifecycle, expectedDraftVersion: 0.5 },
    { ...lifecycle, expectedPublishedVersion: '0' },
    { ...lifecycle, buildId: 'bad' },
    { ...lifecycle, idempotencyKey: 'bad' },
    { ...lifecycle, approved: true },
  ])
    expect(experienceToolInputs[name].safeParse(invalid).success).toBe(false);
});
it('admits only declared tool names and rejects prototype properties', () => {
  for (const name of experienceToolNames)
    expect(isExperienceTool(name)).toBe(true);
  expect(isExperienceTool('constructor')).toBe(false);
  expect(isExperienceTool('unknown')).toBe(false);
});
