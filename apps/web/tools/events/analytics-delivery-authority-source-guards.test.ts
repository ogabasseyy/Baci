import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { analyticsDeliveryAuthoritySourceGuards as guards } from './analytics-delivery-authority-source-guards';

function expression(source: string): ts.Expression {
  const file = ts.createSourceFile(
    'fixture.ts',
    `${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const statement = file.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) {
    throw new Error('expression fixture required');
  }
  return statement.expression;
}

const verified = (node: ts.Expression) => node.getText() === 'context.verified';

describe('analytics delivery authority source guards', () => {
  it.each([
    ['context.ok && context.verified', true, true],
    ['context.verified || input.force', true, false],
    ['context.verified === false', true, false],
    ['disabled || !context.verified', false, true],
    ['context.verified && flag', false, false],
  ])('proves boolean implication for %s', (source, outcome, expected) => {
    expect(
      guards.branchImpliesVerified(expression(source), outcome, verified)
    ).toBe(expected);
  });

  it('recognizes only a directive-prologue use server boundary', () => {
    expect(
      guards.hasLeadingDirective(
        'fixture.ts',
        "'use server'; import './x';",
        'use server'
      )
    ).toBe(true);
    expect(
      guards.hasLeadingDirective(
        'fixture.ts',
        "const x = 1; 'use server'; import './x';",
        'use server'
      )
    ).toBe(false);
  });

  it.each([
    'process.env.FACEBOOK_ACCESS_TOKEN',
    "process.env['SNAPCHAT_CAPI_TOKEN']",
    "process['env'].GA4_API_SECRET",
    'const { TIKTOK_PIXEL_ID: pixel } = process.env',
    'const env = process.env; env.FACEBOOK_ACCESS_TOKEN',
    "const first = process['env']; const second = first; second['SNAPCHAT_CAPI_TOKEN']",
    'const key = getCredentialName(); process.env[key]',
    'const { env } = process; env.FACEBOOK_ACCESS_TOKEN',
    'globalThis.process.env.FB_TEST_EVENT_CODE',
    "Reflect.get(process.env, 'SUPABASE_SERVICE_ROLE_KEY')",
  ])('detects credential environment access in %s', (source) => {
    expect(guards.readsCredentialEnvironment('fixture.ts', source)).toBe(true);
  });

  it('fails closed on any process environment reachability', () => {
    expect(
      guards.readsCredentialEnvironment('fixture.ts', 'process.env.NODE_ENV')
    ).toBe(true);
  });

  it('accepts only a merchant argument proven by its binding callback', () => {
    expect(
      guards.merchantArgumentIsVerified(
        expression('(resolvedMerchantId)'),
        (node) => node.getText() === 'resolvedMerchantId'
      )
    ).toBe(true);
    expect(
      guards.merchantArgumentIsVerified(
        expression('merchantId'),
        (node) => node.getText() === 'resolvedMerchantId'
      )
    ).toBe(false);
  });
});
