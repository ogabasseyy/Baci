import { expect, it } from 'vitest';
import {
  experienceChunkSchema,
  uploadDescriptorSchema,
} from './experience-upload';

it('upload contract rejects oversized chunks, case collisions and aggregate source overflow', () => {
  expect(
    experienceChunkSchema.safeParse({
      uploadId: '10000000-0000-4000-8000-000000000001',
      path: 'a.tsx',
      offset: 0,
      bytes: new Uint8Array(32769),
      chunkDigest: 'a'.repeat(64),
    }).success
  ).toBe(false);
  expect(
    uploadDescriptorSchema.safeParse({
      files: [
        { path: 'A.tsx', bytes: 1, digest: 'a'.repeat(64) },
        { path: 'a.tsx', bytes: 1, digest: 'b'.repeat(64) },
      ],
    }).success
  ).toBe(false);
});
