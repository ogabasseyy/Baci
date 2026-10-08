import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrefundedCardActivationConfig } from './prefunded-card-activation-config';
import { createActivationConfigFixture } from './prefunded-card-activation-config.test-support';

describe('prefunded card activation configuration builder', () => {
  it('builds matching staging compositions with pinned TLS profiles', () => {
    const result = buildPrefundedCardActivationConfig(
      createActivationConfigFixture(),
      new Date('2026-09-27T12:00:00Z')
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('reports scope and CA mismatches without echoing supplied values', () => {
    const input = createActivationConfigFixture();
    Object.assign(input.recovery.scope, {
      merchantId: '99999999-9999-4999-8999-999999999999',
    });
    input.expected.certificateAuthoritySha256 = 'a'.repeat(64);
    const result = buildPrefundedCardActivationConfig(
      input,
      new Date('2026-09-27T12:00:00Z')
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic');
    expect(JSON.stringify(result)).not.toContain('99999999');
  });

  it('refuses an expired fixed window', () => {
    const result = buildPrefundedCardActivationConfig(
      createActivationConfigFixture(),
      new Date('2026-09-29T15:59:10Z')
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ status: 'expired' }],
    });
  });

  it('refuses an invalid preflight clock', () => {
    const result = buildPrefundedCardActivationConfig(
      createActivationConfigFixture(),
      new Date(Number.NaN)
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ prerequisite: 'valid preflight clock' }],
    });
  });

  it('does not accept the placeholder template as activation config', () => {
    const template = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          '../../tools/staging/prefunded-card/activation-config.template.json'
        ),
        'utf8'
      )
    );
    const result = buildPrefundedCardActivationConfig(
      template,
      new Date('2026-09-27T12:00:00Z')
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('OWNER-PROVED');
  });
});
