import { expect, it, vi } from 'vitest';
import {
  captureReplayState,
  findCaptureReplay,
} from './private-capture-replay';

const id = '11111111-1111-4111-8111-111111111111';
const buildId = '22222222-2222-4222-8222-222222222222';
const input = { buildId, routeId: 'home', idempotencyKey: id };
it('finds only an owner-scoped exact request and snapshot match', async () => {
  const state = captureReplayState(input);
  const limit = vi.fn(async () => ({
    data: [
      {
        id,
        build_id: buildId,
        build_digest: 'a'.repeat(64),
        key_digest: 'b'.repeat(64),
        snapshot_key: { state },
      },
    ],
    error: null,
  }));
  const query = {
    select: () => query,
    eq: vi.fn(() => query),
    like: vi.fn(() => query),
    limit,
  };
  const client = { from: vi.fn(() => query) };
  await expect(
    findCaptureReplay(
      client as never,
      id,
      input,
      'a'.repeat(64),
      'b'.repeat(64)
    )
  ).resolves.toBe(id);
  expect(query.eq).toHaveBeenCalledWith('merchant_id', id);
  expect(query.like).toHaveBeenCalledWith(
    'snapshot_key->>state',
    `preview:${id}%`
  );
});
it('rejects reused keys for different input or snapshot instead of returning old evidence', async () => {
  const state = captureReplayState(input);
  const rows = [
    {
      id,
      build_id: buildId,
      build_digest: 'a'.repeat(64),
      key_digest: 'b'.repeat(64),
      snapshot_key: { state },
    },
  ];
  const query = {
    select: () => query,
    eq: () => query,
    like: () => query,
    limit: async () => ({ data: rows, error: null }),
  };
  const client = { from: () => query };
  await expect(
    findCaptureReplay(
      client as never,
      id,
      { ...input, routeId: 'other' },
      'a'.repeat(64),
      'b'.repeat(64)
    )
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  await expect(
    findCaptureReplay(
      client as never,
      id,
      input,
      'a'.repeat(64),
      'c'.repeat(64)
    )
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
