import { createHash } from 'node:crypto';
import { checkoutProxyConfig } from '../../../apps/web/tools/piggyvest-staging/checkout-proxy-config';

const DATABASE_SYSTEM_ID = '7685292944002592802';
const DEADLINE = '2026-09-29T15:59:10Z';
const APP_HOST = 'staging-auth.ogabassey.com';
const ROUTE_PATHS = [
  '/api/storefront/customer/savings/card-checkout',
  '/api/storefront/customer/savings/card-contributions',
  '/savings/card-return',
  '/api/csrf',
] as const;
const REQUIRED_READINESS = [
  'rootPrerequisites',
  'checkoutStorage',
  'treasuryBinding',
  'providerCollection',
  'providerSettlement',
  'webhookRecovery',
  'backgroundRecovery',
  'appArtifact',
  'privateEndToEnd',
] as const;
const TOKEN =
  /\s+|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};"'#]+/g;

type Token = { value: string; start: number; end: number };
type RoutingConfig = { version?: number; routes?: Record<string, unknown>[] };
type CandidateInput = {
  vercelBytes: Uint8Array;
  vercelSha256: string;
  nginxBytes: Uint8Array;
  nginxSha256: string;
  readinessBytes?: Uint8Array;
  readinessSha256?: string;
  now?: Date;
};
type Candidate = {
  vercel: string;
  nginx: string;
  manifest: string;
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyPin(bytes: Uint8Array, expected: string): void {
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(bytes) !== expected)
    throw new Error('Pinned routing baseline checksum mismatch');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  for (const match of source.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start !== offset) throw new Error('Ambiguous Nginx baseline syntax');
    offset = start + match[0].length;
    if (!/^\s+$/.test(match[0]) && !match[0].startsWith('#'))
      tokens.push({ value: match[0], start, end: offset });
  }
  if (offset !== source.length)
    throw new Error('Ambiguous Nginx baseline syntax');
  return tokens;
}

function nginxInsertion(source: string): { offset: number; upstream: string } {
  const tokens = tokenize(source);
  type Block = { directive: string[]; start: number; upstreams: string[] };
  const stack: Block[] = [];
  let directive: string[] = [];
  const servers: Array<{ start: number; end: number }> = [];
  const hosts: number[] = [];
  const locations: Array<{ serverStart: number; block: Block }> = [];
  for (const token of tokens) {
    if (token.value === '{') {
      const block: Block = {
        directive,
        start: token.start,
        upstreams: [],
      };
      stack.push(block);
      if (directive[0] === 'server' && stack.length === 1)
        servers.push({ start: token.start, end: -1 });
      if (
        stack.length === 2 &&
        stack[0]?.directive[0] === 'server' &&
        directive[0] === 'location'
      )
        locations.push({ serverStart: stack[0].start, block });
      directive = [];
      continue;
    }
    if (token.value === ';') {
      if (
        stack.length === 1 &&
        stack[0]?.directive[0] === 'server' &&
        directive[0] === 'server_name' &&
        directive.slice(1).join(' ') === APP_HOST
      )
        hosts.push(stack[0].start);
      const location =
        stack.length === 2 && stack[1]?.directive[0] === 'location'
          ? locations.find(({ block }) => block === stack[1])
          : undefined;
      if (location && directive[0] === 'proxy_pass')
        location.block.upstreams.push(directive.slice(1).join(' '));
      directive = [];
      continue;
    }
    if (token.value === '}') {
      if (directive.length || stack.length === 0)
        throw new Error('Ambiguous Nginx baseline syntax');
      const closed = stack.pop();
      if (stack.length === 0 && closed?.directive[0] === 'server') {
        const server = servers.find(({ start }) => start === closed.start);
        if (server) server.end = token.end;
      }
      continue;
    }
    directive.push(token.value.replace(/^['"]|['"]$/g, ''));
  }
  if (stack.length || directive.length || hosts.length !== 1)
    throw new Error('Expected one exact staging-auth server block');
  const server = servers.find(({ start }) => start === hosts[0]);
  if (!server || server.end < 0)
    throw new Error('Ambiguous staging-auth server block');
  const serverLocations = locations.filter(
    ({ serverStart }) => serverStart === server.start
  );
  if (
    serverLocations.some(
      ({ block }) => block.directive[1] === '~' || block.directive[1] === '~*'
    )
  )
    throw new Error('Ambiguous regex location in staging-auth server');
  for (const path of ROUTE_PATHS) {
    if (
      serverLocations.some(
        ({ block }) => block.directive[1] === '=' && block.directive[2] === path
      )
    )
      throw new Error('Unexpected public route collision');
  }
  const goalAnchors = serverLocations.filter(
    ({ block }) =>
      block.directive[1] === '=' &&
      block.directive[2] === '/api/storefront/customer/savings/goals'
  );
  const goalAnchor = goalAnchors[0];
  if (
    goalAnchors.length !== 1 ||
    !goalAnchor ||
    goalAnchor.block.upstreams.length !== 1 ||
    goalAnchor.block.upstreams[0] !== 'http://127.0.0.1:4795'
  )
    throw new Error('Expected one pinned savings application upstream');
  const upstream = goalAnchor.block.upstreams[0];
  if (!upstream)
    throw new Error('Expected one pinned savings application upstream');
  return { offset: server.end - 1, upstream };
}

function readinessState(input: CandidateInput): {
  ready: boolean;
  digest: string | null;
} {
  if (!input.readinessBytes && !input.readinessSha256)
    return { ready: false, digest: null };
  if (!input.readinessBytes || !input.readinessSha256)
    throw new Error('Readiness report requires an explicit checksum');
  verifyPin(input.readinessBytes, input.readinessSha256);
  const readiness = JSON.parse(
    Buffer.from(input.readinessBytes).toString('utf8')
  ) as unknown;
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness))
    throw new Error('Readiness report shape is invalid');
  const report = readiness as Record<string, unknown>;
  const expectedKeys = [
    'version',
    'databaseSystemId',
    'issuedAt',
    'expiresAt',
    'checks',
  ];
  if (
    Object.keys(report).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in report)) ||
    !report.checks ||
    typeof report.checks !== 'object' ||
    Array.isArray(report.checks)
  )
    throw new Error('Readiness report shape is invalid');
  const checks = report.checks as Record<string, unknown>;
  if (
    Object.keys(checks).length !== REQUIRED_READINESS.length ||
    REQUIRED_READINESS.some((key) => typeof checks[key] !== 'boolean')
  )
    throw new Error('Readiness checks shape is invalid');
  if (
    typeof report.issuedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(report.issuedAt) ||
    !Number.isFinite(Date.parse(report.issuedAt))
  )
    throw new Error('Readiness timestamp is invalid');
  const issuedAt = Date.parse(report.issuedAt);
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Readiness clock is invalid');
  const fresh = issuedAt <= nowMs && nowMs - issuedAt <= 15 * 60 * 1000;
  const ready =
    report.version === 1 &&
    report.databaseSystemId === DATABASE_SYSTEM_ID &&
    report.expiresAt === DEADLINE &&
    fresh &&
    nowMs < Date.parse(DEADLINE) &&
    REQUIRED_READINESS.every((key) => checks[key] === true);
  return { ready, digest: input.readinessSha256 };
}

export function renderPublicRoutingCandidate(input: CandidateInput): Candidate {
  verifyPin(input.vercelBytes, input.vercelSha256);
  verifyPin(input.nginxBytes, input.nginxSha256);
  const readiness = readinessState(input);
  const baseline = JSON.parse(
    Buffer.from(input.vercelBytes).toString('utf8')
  ) as RoutingConfig;
  const baselineDigest = createHash('sha256')
    .update(JSON.stringify(baseline))
    .digest('hex');
  const vercel = checkoutProxyConfig(baseline, baselineDigest) as RoutingConfig;
  const routes = vercel.routes ?? [];
  const returnRoute = routes.find(
    (route) =>
      route.src === '^/savings/card-return$' &&
      route.dest === 'https://staging-auth.ogabassey.com/savings/card-return'
  );
  if (!returnRoute || !Array.isArray(returnRoute.methods))
    throw new Error('Existing four-path Vercel transformer contract changed');
  returnRoute.methods = ['GET'];

  const source = Buffer.from(input.nginxBytes).toString('utf8');
  const { offset, upstream } = nginxInsertion(source);
  const allowed = new Map<string, string[]>();
  for (const route of routes) {
    if (typeof route.src !== 'string' || !Array.isArray(route.methods))
      continue;
    const path = ROUTE_PATHS.find(
      (candidate) => route.src === `^${candidate}$`
    );
    if (path && route.dest === `https://${APP_HOST}${path}`)
      allowed.set(
        path,
        route.methods.filter(
          (method): method is string => typeof method === 'string'
        )
      );
  }
  if (allowed.size !== ROUTE_PATHS.length)
    throw new Error('Four-path route contract is incomplete');
  const locations = ROUTE_PATHS.map((path) => {
    const methods = allowed.get(path);
    if (!methods?.length)
      throw new Error('Four-path route contract is incomplete');
    const expression =
      methods.length === 1 ? methods[0] : `(${methods.join('|')})`;
    return `\n    location = ${path} {\n        if ($request_method !~ ^${expression}$) { return 405; }\n        proxy_pass ${upstream};\n        proxy_set_header Host staging.ogabassey.com;\n        proxy_set_header X-Forwarded-Host staging.ogabassey.com;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header X-Forwarded-Port 443;\n        proxy_set_header X-Forwarded-For $remote_addr;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header Forwarded "";\n        proxy_set_header x-middleware-subrequest "";\n        access_log off;\n    }\n`;
  }).join('');
  const manifest = {
    version: 1,
    candidateOnly: true,
    runtimeReadinessGateOpen: readiness.ready,
    activationAuthorized: false,
    databaseSystemId: DATABASE_SYSTEM_ID,
    deadline: DEADLINE,
    pinnedBaselines: {
      vercelSha256: input.vercelSha256,
      nginxSha256: input.nginxSha256,
    },
    readinessSha256: readiness.digest,
    methods: Object.fromEntries(
      ROUTE_PATHS.map((path) => [path, allowed.get(path)])
    ),
    queryPolicy: 'preserve',
    collectionIsPiggyVestSettlement: false,
  };
  return {
    vercel: `${JSON.stringify(vercel, null, 2)}\n`,
    nginx: `${source.slice(0, offset)}${locations}${source.slice(offset)}`,
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}
