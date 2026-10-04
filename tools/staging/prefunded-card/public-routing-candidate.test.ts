import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderPublicRoutingCandidate } from './public-routing-candidate';

const vercelBaseline = Buffer.from(
  `${JSON.stringify({
    version: 3,
    routes: [
      {
        src: '^/api/storefront/customer/savings/goals$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/goals',
        methods: ['GET', 'POST'],
      },
      { handle: 'filesystem' },
    ],
  })}\n`
);
const nginxBaseline = Buffer.from(`server {
    listen 443 ssl;
    server_name staging-auth.ogabassey.com;
    location = /auth/v1 { proxy_pass http://127.0.0.1:4795; }
    location / { return 404; }
    location @unavailable { return 503; }
    location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }
    location = /api/storefront/customer/savings/goals {
        if ($request_method !~ ^(GET|POST)$) { return 405; }
        proxy_pass http://127.0.0.1:4795;
    }
    location = /api/webhooks/piggyvest { proxy_pass http://127.0.0.1:4791; }
    location = /api/storefront/customer/savings/drafts { proxy_pass http://127.0.0.1:4792; }
    location = /api/storefront/customer/wallet { proxy_pass http://127.0.0.1:4795; }
}
`);
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const input = () => ({
  vercelBytes: vercelBaseline,
  vercelSha256: digest(vercelBaseline),
  nginxBytes: nginxBaseline,
  nginxSha256: digest(nginxBaseline),
  now: new Date('2026-09-27T10:00:00.000Z'),
});
const paths = [
  '/api/storefront/customer/savings/card-checkout',
  '/api/storefront/customer/savings/card-contributions',
  '/savings/card-return',
  '/api/csrf',
];

function expectOnlyRoutingInsertion(candidate: string, baseline: string): void {
  const insertion = candidate.indexOf(
    '\n    location = /api/storefront/customer/savings/card-checkout {'
  );
  const close = baseline.lastIndexOf('}');
  const candidateClose = candidate.lastIndexOf('}');
  expect(insertion).toBeGreaterThanOrEqual(0);
  expect(candidate.slice(0, insertion)).toBe(baseline.slice(0, close));
  expect(candidate.slice(candidateClose)).toBe(baseline.slice(close));
}

describe('public first-card routing candidate', () => {
  it('renders exact allowed methods, rejects fallthrough, and preserves query routing', () => {
    const candidate = renderPublicRoutingCandidate(input());
    const config = JSON.parse(candidate.vercel) as {
      routes: Record<string, unknown>[];
    };
    const added = config.routes.filter(
      (route) =>
        paths.some((path) => route.src === `^${path}$`) &&
        typeof route.dest === 'string'
    );
    expect(added.map((route) => [route.src, route.methods])).toEqual([
      [`^${paths[0]}$`, ['GET', 'POST', 'PATCH']],
      [`^${paths[1]}$`, ['GET', 'POST']],
      [`^${paths[2]}$`, ['GET']],
      [`^${paths[3]}$`, ['GET']],
    ]);
    expect(
      config.routes.filter(
        (route) =>
          paths.some((path) => route.src === `^${path}$`) &&
          route.status === 405
      )
    ).toHaveLength(4);
    expect(candidate.nginx).toContain(
      'if ($request_method !~ ^(GET|POST|PATCH)$) { return 405; }'
    );
    expect(candidate.nginx).toContain('proxy_pass http://127.0.0.1:4795;');
    expect(candidate.nginx).not.toContain('proxy_pass http://127.0.0.1:4795/');
    expect(candidate.manifest).toContain('"queryPolicy": "preserve"');
    expect(candidate.manifest).toContain('"runtimeReadinessGateOpen": false');
    expect(candidate.manifest).toContain('"activationAuthorized": false');
    expect(candidate.vercel).toContain('"handle": "filesystem"');
  });

  it('preserves webhook, intake, drafts, wallet, and fallback routes verbatim', () => {
    const candidate = renderPublicRoutingCandidate(input());
    expectOnlyRoutingInsertion(candidate.nginx, nginxBaseline.toString());
    expect(candidate.nginx).toContain(
      'location = /api/webhooks/piggyvest { proxy_pass http://127.0.0.1:4791; }'
    );
    expect(candidate.nginx).toContain(
      'location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }'
    );
    expect(candidate.nginx).toContain(
      'location = /auth/v1 { proxy_pass http://127.0.0.1:4795; }'
    );
    expect(candidate.nginx).toContain('location @unavailable { return 503; }');
    expect(candidate.nginx).toContain(
      'location = /api/storefront/customer/savings/drafts { proxy_pass http://127.0.0.1:4792; }'
    );
    expect(candidate.nginx).toContain(
      'location = /api/storefront/customer/wallet { proxy_pass http://127.0.0.1:4795; }'
    );
    expect(candidate.manifest).toContain(
      '"collectionIsPiggyVestSettlement": false'
    );
  });

  it.each([
    'before',
    'after',
  ])('anchors insertion with intake %s the savings route', (position) => {
    const original = nginxBaseline.toString();
    const intake =
      '    location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }\n';
    const withoutIntake = original.replace(intake, '');
    const goal = '    location = /api/storefront/customer/savings/goals {';
    const baseline = Buffer.from(
      position === 'before'
        ? withoutIntake.replace(goal, `${intake}${goal}`)
        : withoutIntake.replace(
            '    location = /api/webhooks/piggyvest',
            `${intake}    location = /api/webhooks/piggyvest`
          )
    );
    const candidate = renderPublicRoutingCandidate({
      ...input(),
      nginxBytes: baseline,
      nginxSha256: digest(baseline),
    });
    expectOnlyRoutingInsertion(candidate.nginx, baseline.toString());
  });

  it('refuses checksum mismatches for either baseline', () => {
    expect(() =>
      renderPublicRoutingCandidate({ ...input(), nginxSha256: '0'.repeat(64) })
    ).toThrow(/checksum/);
    expect(() =>
      renderPublicRoutingCandidate({ ...input(), vercelSha256: '0'.repeat(64) })
    ).toThrow(/checksum/);
  });

  it('refuses ambiguous host, upstream, or route collisions', () => {
    const wrongHost = Buffer.from(
      nginxBaseline
        .toString()
        .replace(
          'server_name staging-auth.ogabassey.com;',
          'server_name staging-auth.ogabassey.com other.example;'
        )
    );
    expect(() =>
      renderPublicRoutingCandidate({
        ...input(),
        nginxBytes: wrongHost,
        nginxSha256: digest(wrongHost),
      })
    ).toThrow(/server block/);
    const wrongUpstream = Buffer.from(
      nginxBaseline
        .toString()
        .replace(
          'location = /api/storefront/customer/savings/goals {\n        if ($request_method !~ ^(GET|POST)$) { return 405; }\n        proxy_pass http://127.0.0.1:4795;',
          'location = /api/storefront/customer/savings/goals {\n        if ($request_method !~ ^(GET|POST)$) { return 405; }\n        proxy_pass http://127.0.0.1:4792;'
        )
    );
    expect(() =>
      renderPublicRoutingCandidate({
        ...input(),
        nginxBytes: wrongUpstream,
        nginxSha256: digest(wrongUpstream),
      })
    ).toThrow(/upstream/);
    const collision = Buffer.from(
      nginxBaseline
        .toString()
        .replace(
          'location / { return 404; }',
          'location = /api/csrf { return 404; }'
        )
    );
    expect(() =>
      renderPublicRoutingCandidate({
        ...input(),
        nginxBytes: collision,
        nginxSha256: digest(collision),
      })
    ).toThrow(/collision/);
    const regexLocation = Buffer.from(
      nginxBaseline
        .toString()
        .replace(
          '    location @unavailable { return 503; }',
          '    location ~ ^/unavailable { return 503; }'
        )
    );
    expect(() =>
      renderPublicRoutingCandidate({
        ...input(),
        nginxBytes: regexLocation,
        nginxSha256: digest(regexLocation),
      })
    ).toThrow(/regex location/);
  });

  it('opens the candidate gate only for a pinned full readiness report', () => {
    const checks = Object.fromEntries(
      [
        'rootPrerequisites',
        'checkoutStorage',
        'treasuryBinding',
        'providerCollection',
        'providerSettlement',
        'webhookRecovery',
        'backgroundRecovery',
        'appArtifact',
        'privateEndToEnd',
      ].map((key) => [key, true])
    );
    const readinessBytes = Buffer.from(
      JSON.stringify({
        version: 1,
        databaseSystemId: '7685292944002592802',
        issuedAt: '2026-09-27T09:55:00.000Z',
        expiresAt: '2026-09-29T15:59:10Z',
        checks,
      })
    );
    const ready = renderPublicRoutingCandidate({
      ...input(),
      readinessBytes,
      readinessSha256: digest(readinessBytes),
    });
    expect(ready.manifest).toContain('"runtimeReadinessGateOpen": true');
    expect(ready.manifest).toContain('"activationAuthorized": false');
    expect(() =>
      renderPublicRoutingCandidate({
        ...input(),
        readinessBytes,
        readinessSha256: '0'.repeat(64),
      })
    ).toThrow(/checksum/);
    const incomplete = Buffer.from(
      JSON.stringify({
        version: 1,
        databaseSystemId: '7685292944002592802',
        issuedAt: '2026-09-27T09:55:00.000Z',
        expiresAt: '2026-09-29T15:59:10Z',
        checks: { ...checks, providerSettlement: false },
      })
    );
    const closed = renderPublicRoutingCandidate({
      ...input(),
      readinessBytes: incomplete,
      readinessSha256: digest(incomplete),
    });
    expect(closed.manifest).toContain('"runtimeReadinessGateOpen": false');
    expect(() =>
      renderPublicRoutingCandidate({
        ...input(),
        readinessBytes: Buffer.from('{"version":1,"checks":{}}'),
        readinessSha256: digest(Buffer.from('{"version":1,"checks":{}}')),
      })
    ).toThrow(/shape/);
    const deadlineReport = Buffer.from(
      JSON.stringify({
        ...JSON.parse(readinessBytes.toString()),
        issuedAt: '2026-09-29T15:59:09.000Z',
      })
    );
    expect(
      renderPublicRoutingCandidate({
        ...input(),
        now: new Date('2026-09-29T15:59:10.000Z'),
        readinessBytes: deadlineReport,
        readinessSha256: digest(deadlineReport),
      }).manifest
    ).toContain('"runtimeReadinessGateOpen": false');
  });

  it('generates identical candidates for identical pinned input', () => {
    expect(renderPublicRoutingCandidate(input())).toEqual(
      renderPublicRoutingCandidate(input())
    );
  });
});
