import { expect, it } from 'vitest';
import { parseRunnerProductionConfig } from './production-config';

const key = Buffer.alloc(32, 9).toString('base64url');
const config = { key, toolchainDigest: 'a'.repeat(64), loopbackPort: 43182 };

it('decodes a canonical 32-byte signing key and pins the socket path', () => {
  expect(parseRunnerProductionConfig(config)).toEqual({
    key: Buffer.alloc(32, 9),
    toolchainDigest: 'a'.repeat(64),
    loopbackPort: 43182,
    socketPath: '/var/lib/baci-experience-runner/run/runner.sock',
  });
});

it.each([
  { key: 'secret' },
  { key: Buffer.alloc(31).toString('base64url') },
  { toolchainDigest: 'invalid' },
  { loopbackPort: 0 },
  { socketPath: '/tmp/untrusted.sock' },
  { verifyInstallation: true },
])('rejects unsafe or caller-controlled runner settings: %o', (change) => {
  expect(() => parseRunnerProductionConfig({ ...config, ...change })).toThrow(
    'INVALID_RUNNER_CONFIG'
  );
});
