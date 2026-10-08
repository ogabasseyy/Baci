import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  verifyCacheProvenance,
  verifyScreenshotProvenance,
} from './merchant-image-pilot-settings-provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);

function fixturePng() {
  return readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
}

describe('merchant-image-pilot-settings provenance', () => {
  it('binds cache provenance to a fresh runner reset before the run', () => {
    const pages = [
      {
        _meta: { runId: 'run-navigation-1' },
        startedDateTime: '2026-10-04T00:10:00.000Z',
      },
    ];
    const valid = JSON.stringify({
      event: 'profile-reset',
      freshProfile: true,
      profileDir: '/tmp/run/profile',
      resetAt: '2026-10-04T00:09:00.000Z',
      runId: 'run-navigation-1',
      tool: 'browsertime',
    });
    expect(verifyCacheProvenance(valid, pages)).toEqual({
      ok: true,
      summary: 'browsertime@2026-10-04T00:09:00.000Z',
    });
    expect(verifyCacheProvenance(valid, [...pages, ...pages]).error).toMatch(
      /exactly one HAR iteration/
    );
    expect(verifyCacheProvenance(valid, [...pages, {}]).ok).toBe(false);
    // Unreadable, malformed, and misshapen artifacts fail closed.
    expect(verifyCacheProvenance(null, pages, 'missing.json').error).toMatch(
      /cannot read/
    );
    expect(verifyCacheProvenance('{nope', pages).error).toMatch(
      /not valid JSON/
    );
    for (const [label, patch] of [
      ['event', { event: 'run-start' }],
      ['fresh', { freshProfile: false }],
      ['dir', { profileDir: '' }],
      ['tool', { tool: '' }],
      ['run', { runId: '' }],
      ['run-long', { runId: 'r'.repeat(129) }],
      ['time', { resetAt: 'yesterday' }],
    ]) {
      const broken = JSON.stringify({ ...JSON.parse(valid), ...patch });
      expect(verifyCacheProvenance(broken, pages).ok, label).toBe(false);
    }
    // A bare caller string is not a runner artifact.
    expect(verifyCacheProvenance('"just-a-token"', pages).ok).toBe(false);
    // Stale and post-run resets prove nothing about this run.
    const stale = JSON.stringify({
      ...JSON.parse(valid),
      resetAt: '2026-10-03T22:00:00.000Z',
    });
    expect(verifyCacheProvenance(stale, pages).error).toMatch(/stale/);
    const postdated = JSON.stringify({
      ...JSON.parse(valid),
      resetAt: '2026-10-04T00:11:00.000Z',
    });
    expect(verifyCacheProvenance(postdated, pages).error).toMatch(/postdates/);
    // Undated HAR pages cannot bind the reset to the run.
    expect(
      verifyCacheProvenance(valid, [{ _meta: { runId: 'run-navigation-1' } }])
        .error
    ).toMatch(/no startedDateTime/);
    // One reset certifies exactly one navigation: a reused artifact
    // against a second single-page HAR (different runId) fails, as does
    // a page that carries no runId at all.
    expect(
      verifyCacheProvenance(valid, [
        {
          _meta: { runId: 'run-navigation-2' },
          startedDateTime: '2026-10-04T00:10:00.000Z',
        },
      ]).error
    ).toMatch(/does not match the measured navigation/);
    expect(verifyCacheProvenance(valid, [{}]).error).toMatch(/no _meta\.runId/);
  });

  it('binds screenshot bytes to the measured HAR navigation', async () => {
    const pages = [
      {
        _meta: { runId: 'run-navigation-1' },
        startedDateTime: '2026-10-04T00:10:00.000Z',
      },
    ];
    const shot = await fixturePng();
    const sha = createHash('sha256').update(shot).digest('hex');
    const valid = JSON.stringify({
      capturedAt: '2026-10-04T00:10:30.000Z',
      event: 'screenshot-capture',
      runId: 'run-navigation-1',
      screenshotSha256: sha,
      tool: 'browsertime',
    });
    expect(verifyScreenshotProvenance(valid, pages, shot, 'shot.json')).toEqual(
      {
        ok: true,
        summary: 'browsertime@2026-10-04T00:10:30.000Z',
      }
    );
    expect(
      verifyScreenshotProvenance(valid, [...pages, ...pages], shot, 'shot.json')
        .error
    ).toMatch(/exactly one HAR iteration/);
    // Unreadable, malformed, and misshapen artifacts fail closed.
    expect(
      verifyScreenshotProvenance(null, pages, shot, 'missing.json').error
    ).toMatch(/cannot read/);
    expect(
      verifyScreenshotProvenance('{nope', pages, shot, 'shot.json').error
    ).toMatch(/not valid JSON/);
    for (const [label, patch] of [
      ['event', { event: 'profile-reset' }],
      ['tool', { tool: '' }],
      ['run', { runId: '' }],
      ['run-long', { runId: 'r'.repeat(129) }],
      ['sha', { screenshotSha256: 'zz' }],
      ['time', { capturedAt: 'yesterday' }],
    ]) {
      const broken = JSON.stringify({ ...JSON.parse(valid), ...patch });
      expect(
        verifyScreenshotProvenance(broken, pages, shot, 'shot.json').ok,
        label
      ).toBe(false);
    }
    // A stale screenshot from another iteration cannot certify this HAR:
    // different bytes fail the hash, a foreign runId fails the binding.
    const other = Buffer.from('not the measured screenshot');
    expect(
      verifyScreenshotProvenance(valid, pages, other, 'shot.json').error
    ).toMatch(/does not match the supplied screenshot bytes/);
    expect(
      verifyScreenshotProvenance(
        valid,
        [
          {
            _meta: { runId: 'run-navigation-2' },
            startedDateTime: '2026-10-04T00:10:00.000Z',
          },
        ],
        shot,
        'shot.json'
      ).error
    ).toMatch(/does not match the measured navigation/);
    expect(
      verifyScreenshotProvenance(valid, [{}], shot, 'shot.json').error
    ).toMatch(/no _meta\.runId/);
    // Captures outside the navigation window prove nothing about it.
    const predated = JSON.stringify({
      ...JSON.parse(valid),
      capturedAt: '2026-10-04T00:09:00.000Z',
    });
    expect(
      verifyScreenshotProvenance(predated, pages, shot, 'shot.json').error
    ).toMatch(/predates/);
    const stale = JSON.stringify({
      ...JSON.parse(valid),
      capturedAt: '2026-10-04T02:30:00.000Z',
    });
    expect(
      verifyScreenshotProvenance(stale, pages, shot, 'shot.json').error
    ).toMatch(/stale/);
    expect(
      verifyScreenshotProvenance(
        valid,
        [{ _meta: { runId: 'run-navigation-1' } }],
        shot,
        'shot.json'
      ).error
    ).toMatch(/no startedDateTime/);
  });
});
