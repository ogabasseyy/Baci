import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  matchAcceptance,
  parsePilotAcceptance,
} from './acceptance.mjs';

const RECIPE = 'pilot-r1-0123456789abcdef';
const SOURCE = 'b'.repeat(64);

function tierHashes() {
  const hashes = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp']) {
      hashes.push(
        createHash('sha256').update(`${requestedWidth}:${format}`).digest('hex')
      );
    }
  }
  return hashes.sort();
}

function manifest(overrides = {}) {
  return {
    assetId: 'logo-1',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    recipeId: RECIPE,
    role: 'logo',
    source: { sha256: SOURCE },
    tiers: tierHashes().map((sha, index) => ({
      format: index % 2 === 0 ? 'avif' : 'webp',
      requestedWidth: [96, 192, 384][Math.floor(index / 2)],
      sha256: sha,
    })),
    ...overrides,
  };
}

function acceptance(overrides = {}) {
  return {
    assetId: 'logo-1',
    generationId: 'c'.repeat(64),
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    note: 'Text legible at 96/192/384; brand blue preserved; edges clean.',
    outputHashes: tierHashes(),
    originalUrl: 'https://cdn.example.com/media/logo-1.png',
    recipeId: RECIPE,
    reviewedAt: '2026-10-01T21:00:00.000Z',
    reviewer: 'pilot-owner',
    schemaVersion: 1,
    sourceSha256: SOURCE,
    verdict: 'accepted',
    ...overrides,
  };
}

test('parsePilotAcceptance accepts a complete record', () => {
  const result = parsePilotAcceptance(acceptance());
  assert.equal(result.ok, true);
});

test('parsePilotAcceptance rejects malformed records strictly', () => {
  assert.equal(parsePilotAcceptance({ ...acceptance(), extra: 1 }).ok, false);
  assert.equal(
    parsePilotAcceptance(acceptance({ verdict: 'maybe' })).ok,
    false
  );
  assert.equal(
    parsePilotAcceptance(acceptance({ outputHashes: [] })).ok,
    false
  );
  assert.equal(
    parsePilotAcceptance(acceptance({ outputHashes: ['short'] })).ok,
    false
  );
  assert.equal(
    parsePilotAcceptance(acceptance({ note: 'x'.repeat(501) })).ok,
    false
  );
  assert.equal(
    parsePilotAcceptance(acceptance({ reviewer: '' })).ok,
    false
  );
  assert.equal(
    parsePilotAcceptance(acceptance({ originalUrl: 'not-a-url' })).ok,
    false
  );
  assert.equal(
    parsePilotAcceptance(acceptance({ originalUrl: 'ftp://cdn.example.com/x.png' })).ok,
    false
  );
});

test('matchAcceptance binds every identity and output hash', () => {
  assert.deepEqual(matchAcceptance({ acceptance: acceptance(), binding: { originalUrl: 'https://cdn.example.com/media/logo-1.png' }, manifest: manifest() }), {
    ok: true,
  });
});

test('matchAcceptance binds capped rungs positionally, not as a set', () => {
  const deduped = manifest();
  // Small sources share one file across requested tiers; the record still
  // lists one hash per tier position so each rung stays bound.
  deduped.tiers = deduped.tiers.map((tier) => ({ ...tier, sha256: tierHashes()[0] }));
  const record = acceptance({ outputHashes: Array(6).fill(tierHashes()[0]) });
  assert.deepEqual(matchAcceptance({ acceptance: record, binding: { originalUrl: 'https://cdn.example.com/media/logo-1.png' }, manifest: deduped }), { ok: true });
  const short = acceptance({ outputHashes: [tierHashes()[0]] });
  const result = matchAcceptance({ acceptance: short, binding: { originalUrl: 'https://cdn.example.com/media/logo-1.png' }, manifest: deduped });
  assert.equal(result.ok, false);
});

test('matchAcceptance invalidates on any drift or rejection', () => {
  const swapped = manifest();
  swapped.tiers = swapped.tiers.map((tier, index, tiers) => ({
    ...tier,
    sha256: tiers[(index + 2) % tiers.length].sha256,
  }));
  const cases = [
    ['rejected verdict', acceptance({ verdict: 'rejected' }), manifest()],
    ['changed source', acceptance(), manifest({ source: { sha256: 'd'.repeat(64) } })],
    ['changed recipe', acceptance(), manifest({ recipeId: 'pilot-r1-other' })],
    ['changed merchant', acceptance(), manifest({ merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20' })],
    ['changed asset', acceptance(), manifest({ assetId: 'logo-2' })],
    ['changed output bytes', acceptance({ outputHashes: ['e'.repeat(64)] }), manifest()],
    // Same hash set, wrong rungs: positional binding rejects the swap.
    ['swapped tier hashes', acceptance(), swapped],
    ['reordered record hashes', acceptance({ outputHashes: [...tierHashes()].reverse() }), manifest()],
    ['retargeted original URL', acceptance({ originalUrl: 'https://cdn.example.com/media/logo-2.png' }), manifest()],
  ];
  for (const [label, record, manifestValue] of cases) {
    const result = matchAcceptance({ acceptance: record, binding: { originalUrl: 'https://cdn.example.com/media/logo-1.png' }, manifest: manifestValue });
    assert.equal(result.ok, false, label);
    assert.ok(result.reason.length > 0, label);
  }
});
