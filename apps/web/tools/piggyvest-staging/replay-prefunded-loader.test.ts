// @vitest-environment node

import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';
import { loadPrefundedReplay } from './replay-prefunded-loader';
import type { readProtectedReplayFile } from './replay-protected-file';

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

it.each([
  'integrationId',
  'businessId',
  'expectedSystemId',
])('refuses paired %s mismatch against actual digest-verified private scope before import', async (field) => {
  const sample = fixture();
  const paired = createPaidInterestTestFixture();
  sample.dependencies.read
    .mockReset()
    .mockResolvedValueOnce(paired.privateBytes)
    .mockResolvedValueOnce(sample.bundle);
  const paidInterestScope = {
    integrationId: paired.scope.integrationId,
    businessId: paired.scope.businessId,
    expectedSystemId: paired.scope.expectedSystemId,
    [field]:
      field === 'integrationId' ? '40000000-0000-4000-8000-000000000009' : '1',
  };
  await expect(
    loadPrefundedReplay(
      {
        ...sample.input,
        activation: {
          ...sample.input.activation,
          configurationSha256: sha256(paired.privateBytes),
        },
        paidInterestScope,
      },
      sample.dependencies
    )
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.dependencies.importModule).not.toHaveBeenCalled();
  expect(sample.factory).not.toHaveBeenCalled();
});

it('passes the original private configuration and unchanged two-callback ABI after scope pairing', async () => {
  const sample = fixture();
  const paired = createPaidInterestTestFixture();
  sample.dependencies.read
    .mockReset()
    .mockResolvedValueOnce(paired.privateBytes)
    .mockResolvedValueOnce(sample.bundle);
  await expect(
    loadPrefundedReplay(
      {
        ...sample.input,
        activation: {
          ...sample.input.activation,
          configurationSha256: sha256(paired.privateBytes),
        },
        paidInterestScope: {
          integrationId: paired.scope.integrationId,
          businessId: paired.scope.businessId,
          expectedSystemId: paired.scope.expectedSystemId,
        },
      },
      sample.dependencies
    )
  ).resolves.toEqual(sample.runtime);
  expect(sample.factory).toHaveBeenCalledExactlyOnceWith({
    configuration: { scope: paired.scope },
    expectedAppSystemId: sample.input.expectedAppSystemId,
    fetchImplementation: sample.dependencies.fetchImplementation,
  });
  expect(Object.keys(sample.runtime)).toEqual(['resolveEnrollment', 'replay']);
});

it('requires a fully parsed private scope in paired mode rather than caller assertions alone', async () => {
  const sample = fixture();
  const paired = createPaidInterestTestFixture();
  await expect(
    loadPrefundedReplay(
      {
        ...sample.input,
        paidInterestScope: {
          integrationId: paired.scope.integrationId,
          businessId: paired.scope.businessId,
          expectedSystemId: paired.scope.expectedSystemId,
        },
      },
      sample.dependencies
    )
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.factory).not.toHaveBeenCalled();
  expect(sample.dependencies.importModule).not.toHaveBeenCalled();
});

function fixture() {
  const configuration = Buffer.from('{"synthetic":"only"}');
  const bundle = Buffer.from('synthetic bundle bytes');
  const runtime = { resolveEnrollment: vi.fn(), replay: vi.fn() };
  const factory = vi.fn(async () => runtime);
  const dependencies = {
    read: vi
      .fn<typeof readProtectedReplayFile>()
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce(bundle),
    importModule: vi
      .fn<(url: string) => Promise<unknown>>()
      .mockResolvedValue({ createPrefundedCardReplayRuntime: factory }),
    fetchImplementation: vi.fn<typeof fetch>(),
  };
  const input = {
    activation: {
      bundleSha256: sha256(bundle),
      configurationSha256: sha256(configuration),
    },
    expectedAppSystemId: '7685292944002592802',
  };
  return { input, dependencies, factory, runtime, configuration, bundle };
}

it('loads only fixed protected paths and awaits runtime readiness after both digests match', async () => {
  const sample = fixture();
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).resolves.toEqual(sample.runtime);
  expect(sample.dependencies.read.mock.calls[0][0]).toEqual({
    path: '/run/pvb-replay/prefunded.json',
    maximumBytes: 131_072,
    allowedModes: [0o400, 0o440, 0o600],
  });
  expect(sample.dependencies.read.mock.calls[1][0].path).toMatch(
    /\/prefunded-replay-bundle\.mjs$/
  );
  expect(sample.dependencies.importModule).toHaveBeenCalledExactlyOnceWith(
    new URL('./prefunded-replay-bundle.mjs', import.meta.url).href
  );
  expect(sample.factory).toHaveBeenCalledExactlyOnceWith({
    configuration: { synthetic: 'only' },
    expectedAppSystemId: sample.input.expectedAppSystemId,
    fetchImplementation: sample.dependencies.fetchImplementation,
  });
  expect(sample.runtime.replay).not.toHaveBeenCalled();
  expect(sample.runtime.resolveEnrollment).not.toHaveBeenCalled();
  expect(sample.dependencies.fetchImplementation).not.toHaveBeenCalled();
});

it.each([
  'bundleSha256',
  'configurationSha256',
])('never imports or falls back after %s mismatch', async (property) => {
  const sample = fixture();
  await expect(
    loadPrefundedReplay(
      {
        ...sample.input,
        activation: { ...sample.input.activation, [property]: '0'.repeat(64) },
      },
      sample.dependencies
    )
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.dependencies.importModule).not.toHaveBeenCalled();
  expect(sample.factory).not.toHaveBeenCalled();
});

it('rejects another database or configurable path before reading credentials', async () => {
  const sample = fixture();
  await expect(
    loadPrefundedReplay(
      { ...sample.input, expectedAppSystemId: '1' },
      sample.dependencies
    )
  ).rejects.toThrow('Staging prefunded replay unavailable');
  await expect(
    loadPrefundedReplay(
      {
        ...sample.input,
        activation: {
          ...sample.input.activation,
          module: '/tmp/other.mjs',
        },
      },
      sample.dependencies
    )
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.dependencies.read).not.toHaveBeenCalled();
});

it('refuses missing protected files without leaking their errors', async () => {
  const sample = fixture();
  sample.dependencies.read
    .mockReset()
    .mockRejectedValue(new Error('private pathname secret'));
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.dependencies.importModule).not.toHaveBeenCalled();
});

it.each([
  Buffer.from('{'),
  Buffer.from([0xff]),
])('refuses malformed credential bytes before loading code', async (bytes) => {
  const sample = fixture();
  sample.dependencies.read.mockReset().mockResolvedValueOnce(bytes);
  sample.input.activation.configurationSha256 = sha256(bytes);
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.dependencies.importModule).not.toHaveBeenCalled();
});

it('refuses a privileged runtime capability surface', async () => {
  const sample = fixture();
  sample.dependencies.importModule.mockResolvedValueOnce({
    createPrefundedCardReplayRuntime: vi.fn(() => ({
      ...sample.runtime,
      tick: vi.fn(),
    })),
  });
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).rejects.toThrow('Staging prefunded replay unavailable');
});

it('refuses a module without the reviewed replay factory export', async () => {
  const sample = fixture();
  sample.dependencies.importModule.mockResolvedValueOnce({
    default: sample.factory,
  });
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.factory).not.toHaveBeenCalled();
});

it('redacts factory configuration failures instead of invoking replay', async () => {
  const sample = fixture();
  sample.factory.mockImplementation(() => {
    throw new Error('secret=private');
  });
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.runtime.replay).not.toHaveBeenCalled();
});

it('refuses asynchronous database readiness failure before exposing callbacks', async () => {
  const sample = fixture();
  sample.factory.mockRejectedValue(new Error('database credentials=private'));
  await expect(
    loadPrefundedReplay(sample.input, sample.dependencies)
  ).rejects.toThrow('Staging prefunded replay unavailable');
  expect(sample.runtime.resolveEnrollment).not.toHaveBeenCalled();
  expect(sample.runtime.replay).not.toHaveBeenCalled();
});
