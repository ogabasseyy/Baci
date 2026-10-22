// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const probeFiles = {
  cimd: 'cimd.probe.mjs',
  gateway: 'gateway.probe.test-support.mjs',
  upstream: 'upstream.probe.test-support.mjs',
} as const;

it('keeps every opt-in probe entrypoint available even when execution is disabled', () => {
  for (const file of Object.values(probeFiles))
    expect(existsSync(new URL(`./${file}`, import.meta.url))).toBe(true);
});

const enabled = process.env.BACI_BUILDER_OAUTH_PROBE === '1';
describe.skipIf(!enabled)('real local OAuth candidate', () => {
  it('enforces the outer provider protocol against HTTPS endpoints', () => {
    const output = execFileSync(
      process.execPath,
      ['tools/builder-oauth-spike/provider.probe.mjs'],
      {
        encoding: 'utf8',
        timeout: 45_000,
      }
    );
    const report: { checks: string[]; provider: string } = JSON.parse(
      output.trim().split('\n').at(-1) ?? ''
    );
    if (process.env.BACI_BUILDER_OAUTH_EVIDENCE_DIR)
      writeFileSync(
        resolve(process.env.BACI_BUILDER_OAUTH_EVIDENCE_DIR, 'provider.json'),
        `${JSON.stringify(report, null, 2)}\n`
      );
    expect(report.provider).toBe('oidc-provider@9.12.2');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        'HTTPS discovery and S256',
        'missing PKCE rejected',
        'plain PKCE rejected',
        'unknown redirect rejected',
        'wrong authorization resource rejected',
        'wrong exchange resource rejected',
        'valid code exchange',
        'rotation and family reuse revocation',
        'restart persistence',
      ])
    );
  }, 50_000);
  for (const [file, required] of [
    [
      'cimd',
      [
        'plural methods and compatible singular preference',
        'private and unknown client URLs rejected before fetch',
        'redirecting metadata rejected',
      ],
    ],
    [
      'gateway',
      [
        'SDK v2 transport accepts provider-issued audience',
        'wrong audience issuer and expiry rejected at both components',
        'gateway redirects are not followed',
      ],
    ],
    [
      'upstream',
      [
        'inner state nonce and PKCE reject outer-flow substitution',
        'local disconnect revokes only one link and preserves browser and second link',
        'explicit whole-client grant revocation invalidates both links',
      ],
    ],
  ] as const) {
    it(`proves the ${file} boundary`, () => {
      const output = execFileSync(
        process.execPath,
        [`tools/builder-oauth-spike/${probeFiles[file]}`],
        { encoding: 'utf8', timeout: 90_000 }
      );
      const report: { checks: string[] } = JSON.parse(
        output.trim().split('\n').at(-1) ?? ''
      );
      if (process.env.BACI_BUILDER_OAUTH_EVIDENCE_DIR)
        writeFileSync(
          resolve(process.env.BACI_BUILDER_OAUTH_EVIDENCE_DIR, `${file}.json`),
          `${JSON.stringify(report, null, 2)}\n`
        );
      expect(report.checks).toEqual(expect.arrayContaining([...required]));
    }, 95_000);
  }
});
