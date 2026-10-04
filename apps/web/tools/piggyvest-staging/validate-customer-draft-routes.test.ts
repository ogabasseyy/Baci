import { describe, expect, it } from 'vitest';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';
import { validateCustomerDraftRoutes } from './validate-customer-draft-routes';

type FixtureRoute = {
  src?: string;
  dest?: string;
  methods?: string[];
  handle?: string;
};

function fixture(routes: FixtureRoute[]) {
  return { version: 3, routes };
}

function passing() {
  return fixture([
    ...customerDraftProxyRoutes(),
    { handle: 'filesystem' },
  ]);
}

function failuresOf(config: { version: number; routes: FixtureRoute[] }) {
  return validateCustomerDraftRoutes(config)
    .filter((verdict) => !verdict.pass)
    .map((verdict) => verdict.rule);
}

describe('generated routing configuration validation', () => {
  it('passes the complete matrix for the expected generated config', () => {
    const verdicts = validateCustomerDraftRoutes(passing());
    expect(verdicts.length).toBeGreaterThan(20);
    expect(failuresOf(passing())).toEqual([]);
  });

  it('fails when a draft route sits after the filesystem handler', () => {
    const [first, ...rest] = customerDraftProxyRoutes();
    const config = fixture([
      ...rest,
      { handle: 'filesystem' },
      ...(first ? [first] : []),
    ]);
    expect(failuresOf(config)).toContain('routes-before-filesystem');
    expect(failuresOf(config)).toContain(
      'proxied:GET /api/storefront/customer/savings/drafts'
    );
  });

  it('fails when the webhook receiver is rerouted away from the app', () => {
    const config = fixture([
      {
        src: '^/api/webhooks/piggyvest$',
        dest: 'https://staging-auth.ogabassey.com/api/webhooks/piggyvest',
      },
      ...customerDraftProxyRoutes(),
      { handle: 'filesystem' },
    ]);
    expect(failuresOf(config)).toContain(
      'filesystem:GET /api/webhooks/piggyvest'
    );
    expect(failuresOf(config)).toContain(
      'filesystem:POST /api/webhooks/piggyvest'
    );
  });

  it('fails when methods are dropped and other verbs would proxy upstream', () => {
    const config = fixture([
      {
        src: '^/api/storefront/customer/savings/drafts$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/drafts',
      },
      ...customerDraftProxyRoutes().slice(1),
      { handle: 'filesystem' },
    ]);
    expect(failuresOf(config)).toContain('exact-routes-present-verbatim');
    expect(failuresOf(config)).toContain(
      'filesystem:PUT /api/storefront/customer/savings/drafts'
    );
  });

  it('fails closed when the filesystem handler is missing', () => {
    const config = fixture([...customerDraftProxyRoutes()]);
    expect(failuresOf(config)).toContain('filesystem-handler-present');
    expect(failuresOf(config)).toContain(
      'filesystem:GET /api/webhooks/piggyvest'
    );
  });
});
