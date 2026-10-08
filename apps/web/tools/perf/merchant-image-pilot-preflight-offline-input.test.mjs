import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  checkBindingAcceptance,
  checkBindingInput,
} from './merchant-image-pilot-preflight-offline-input.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function inputRootWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'pilot-offline-input-'));
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(root, 'snapshots'), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  return root;
}

function recordFor(overrides = {}) {
  return {
    assetId: 'logo-a',
    merchantId: MERCHANT,
    sha256: 'd'.repeat(64),
    sourcePath: 'snapshots/logo-a.png',
    ...overrides,
  };
}

describe('checkBindingInput', () => {
  it('passes when the frozen snapshot hashes to the inventory claim', async () => {
    const bytes = Buffer.from('frozen-input-bytes');
    const root = await inputRootWith({ 'snapshots/logo-a.png': bytes });
    const checks = [];
    const failures = [];
    const inputBytes = await checkBindingInput({
      checks,
      failures,
      name: `${MERCHANT}/logo-a`,
      options: { inputRoot: root },
      record: recordFor({ sha256: sha256(bytes) }),
    });
    expect(Buffer.isBuffer(inputBytes)).toBe(true);
    expect(inputBytes.equals(bytes)).toBe(true);
    expect(failures).toEqual([]);
    expect(checks).toEqual([{ name: `${MERCHANT}/logo-a:input`, ok: true }]);
  });

  it('rejects snapshots over the generator input cap despite matching hashes', async () => {
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1, 0x61);
    const root = await inputRootWith({ 'snapshots/logo-a.png': bytes });
    const checks = [];
    const failures = [];
    const inputBytes = await checkBindingInput({
      checks,
      failures,
      name: `${MERCHANT}/logo-a`,
      options: { inputRoot: root },
      record: recordFor({ sha256: sha256(bytes) }),
    });
    expect(inputBytes).toBeNull();
    expect(failures.join('\n')).toMatch(/exceeds the .* byte input limit/);
  });

  it('fails closed on missing or tampered snapshots', async () => {
    const bytes = Buffer.from('frozen-input-bytes');
    const root = await inputRootWith({ 'snapshots/logo-a.png': bytes });
    for (const [label, record, pattern] of [
      ['missing', recordFor({ sourcePath: 'snapshots/gone.png' }), /missing/],
      ['tampered', recordFor({ sha256: 'e'.repeat(64) }), /hash mismatch/],
    ]) {
      const checks = [];
      const failures = [];
      const inputBytes = await checkBindingInput({
        checks,
        failures,
        name: label,
        options: { inputRoot: root },
        record,
      });
      expect(inputBytes, label).toBeNull();
      expect(failures.join('\n')).toMatch(pattern);
    }
  });

  it('fails closed when the snapshot escapes the input root', async () => {
    const root = await inputRootWith({});
    const outsideFile = join(dirname(root), `evil-${Date.now()}.png`);
    await writeFile(outsideFile, 'outside');
    const checks = [];
    const failures = [];
    const inputBytes = await checkBindingInput({
      checks,
      failures,
      name: 'escape',
      options: { inputRoot: root },
      record: recordFor({
        sha256: sha256(Buffer.from('outside')),
        sourcePath: `../${outsideFile.split('/').pop()}`,
      }),
    });
    expect(inputBytes).toBeNull();
    expect(failures.join('\n')).toMatch(/escapes the input root/);
  });

  it('fails closed on symlinked directories resolving outside', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'pilot-offline-outside-'));
    const outsideFile = join(outside, 'real.png');
    const bytes = Buffer.from('outside-bytes');
    await writeFile(outsideFile, bytes);
    const root = await inputRootWith({});
    await symlink(outside, join(root, 'linked'));
    const checks = [];
    const failures = [];
    const inputBytes = await checkBindingInput({
      checks,
      failures,
      name: 'symlink',
      options: { inputRoot: root },
      record: recordFor({
        sha256: sha256(bytes),
        sourcePath: 'linked/real.png',
      }),
    });
    expect(inputBytes).toBeNull();
    expect(failures.join('\n')).toMatch(/escapes the input root/);
  });
});

describe('checkBindingAcceptance', () => {
  const record = {
    assetId: 'logo-a',
    merchantId: MERCHANT,
  };
  const acceptance = {
    recipeId: 'pilot/r1',
    sourceSha256: 'd'.repeat(64),
    verdict: 'accepted',
  };
  const base = {
    byAsset: new Map([
      ['6b5cb8a4-5575-456c-b936-8cdfae30db74/logo-a', acceptance],
    ]),
    conflicting: new Set(),
    effectiveRecipe: 'pilot/r1',
    name: `${MERCHANT}/logo-a`,
    record: { ...record, sha256: 'd'.repeat(64) },
  };

  function run(overrides = {}) {
    const checks = [];
    const failures = [];
    const result = checkBindingAcceptance({
      ...base,
      checks,
      failures,
      ...overrides,
    });
    return { checks, failures, result };
  }

  it('returns the acceptance on a clean match', () => {
    const { failures, result } = run();
    expect(result).toBe(acceptance);
    expect(failures).toEqual([]);
  });

  it('fails closed on conflict, absence, verdict, recipe, and hash drift', () => {
    for (const [label, overrides, pattern] of [
      [
        'conflict',
        { conflicting: new Set([`${MERCHANT}/logo-a`]) },
        /conflicting/,
      ],
      ['missing', { byAsset: new Map() }, /no acceptance record/],
      [
        'rejected',
        {
          byAsset: new Map([
            [`${MERCHANT}/logo-a`, { ...acceptance, verdict: 'rejected' }],
          ]),
        },
        /verdict is "rejected"/,
      ],
      [
        'stale',
        {
          byAsset: new Map([
            [`${MERCHANT}/logo-a`, { ...acceptance, recipeId: 'pilot/r0' }],
          ]),
        },
        /not current/,
      ],
      [
        'drift',
        { record: { ...record, sha256: 'e'.repeat(64) } },
        /differs from inventory/,
      ],
    ]) {
      const { failures, result } = run(overrides);
      expect(result, label).toBeNull();
      expect(failures.join('\n'), label).toMatch(pattern);
    }
  });
});
