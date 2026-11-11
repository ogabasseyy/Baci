import { expect, it } from 'vitest';
import { verifyCompiledCandidate } from './compiled-candidate';
import { digestBytes } from './manifest-digest';

const candidate = (path: string) => ({
  javascript: 'export{}',
  css: '',
  digest: digestBytes('export{}\0'),
  imports: [path],
});
it.each([
  'node_modules/../../apps/web/src/x.ts',
  'workspace/packages/shared/../../../secret',
  'workspace/packages/experience-sdk/./src/index.ts',
  '../node_modules/react/../../src/private.ts',
])('rejects traversal after a permitted import prefix: %s', (path) => {
  expect(() => verifyCompiledCandidate(candidate(path))).toThrow(
    'BUILD_FAILED'
  );
});
it.each([
  'node_modules/react/index.js',
  '../node_modules/react/index.js',
  '../../node_modules/react/index.js',
  'workspace/packages/shared/src/index.ts',
  'source:virtual/../component.tsx',
])('preserves pinned dependency roots and virtual source entries: %s', (path) => {
  expect(verifyCompiledCandidate(candidate(path)).imports).toEqual([path]);
});
