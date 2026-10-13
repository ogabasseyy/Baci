const origin = 'https://staging.ogabassey.com';
const endpoint = 'https://staging-auth.ogabassey.com';

function includesHeader(response, header, required) {
  const values = (response.headers.get(header) ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim());
  return required.every((value) => values.includes(value));
}

function preflightPassed(response) {
  return (
    response.status === 204 &&
    response.headers.get('access-control-allow-origin') === origin &&
    response.headers.get('access-control-allow-credentials') === null &&
    includesHeader(response, 'access-control-allow-methods', ['post']) &&
    includesHeader(response, 'access-control-allow-headers', [
      'authorization',
      'apikey',
      'content-type',
    ]) &&
    includesHeader(response, 'vary', ['origin'])
  );
}

export async function checkHostedAccess(transport = fetch) {
  const probes = [
    { name: 'anonymous-user-denied', path: '/auth/v1/user', status: 401 },
    { name: 'admin-denied', path: '/auth/v1/admin/users', status: 403 },
    { name: 'signup-denied', path: '/auth/v1/signup', status: 403 },
    { name: 'unknown-route-denied', path: '/not-a-staging-route', status: 404 },
    {
      name: 'draft-preflight',
      path: '/rest/v1/rpc/customer_savings_draft_command',
      method: 'OPTIONS',
      origin,
    },
    {
      name: 'foreign-origin-denied',
      path: '/rest/v1/rpc/customer_savings_draft_command',
      method: 'OPTIONS',
      origin: 'https://untrusted.example.invalid',
      status: 403,
    },
  ];
  const checks = [];
  for (const probe of probes) {
    try {
      const response = await transport(`${endpoint}${probe.path}`, {
        method: probe.method ?? 'GET',
        headers: probe.origin
          ? {
              Origin: probe.origin,
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers':
                'authorization,apikey,content-type',
            }
          : {},
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      });
      const passed =
        probe.name === 'draft-preflight'
          ? preflightPassed(response)
          : response.status === probe.status;
      await response.body?.cancel();
      checks.push({ name: probe.name, status: response.status, passed });
    } catch {
      checks.push({ name: probe.name, status: null, passed: false });
    }
  }
  return {
    accessChecksPassed: checks.every((check) => check.passed),
    financialEndToEndVerified: false,
    checks,
  };
}
