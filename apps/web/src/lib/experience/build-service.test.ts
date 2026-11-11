import { expect, it } from 'vitest';
import { verifyCompiledCandidate } from './build-service';
import { digestBytes } from './manifest-digest';

it('rejects success flags, incorrect hashes and remote import graphs', () => {
  expect(() => verifyCompiledCandidate({ success: true })).toThrow(
    'BUILD_FAILED'
  );
  expect(() =>
    verifyCompiledCandidate({
      javascript: 'export{}',
      css: '',
      digest: 'a'.repeat(64),
      imports: ['https://evil.test/x'],
    })
  ).toThrow('BUILD_FAILED');
});
it('accepts the pinned workspace package graph without treating package metadata paths as host file reads', () => {
  const javascript = 'export{}';
  const css = '';
  const digest = digestBytes(`${javascript}\0${css}`);
  expect(
    verifyCompiledCandidate({
      javascript,
      css,
      digest,
      imports: [
        'workspace/packages/experience-sdk/src/channel.ts',
        'source:__baci_runtime__.tsx',
        'node_modules/react/index.js',
      ],
    })
  ).toMatchObject({ digest });
});
