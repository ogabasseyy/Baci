// All funding-plane routes share the funding service: its build is the one
// verified end to end (goal create/persist, wallet snapshot), while the
// drafts box answers goal creation with SAVINGS_DEVICE_VARIANT_NOT_FOUND
// for the synthetic catalogue. Drafts traffic stays on :4792 untouched.
const routes = [
  {
    path: '/api/storefront/customer/savings/goals',
    methods: ['GET', 'POST'],
    port: 4795,
  },
  {
    path: '/api/storefront/customer/savings/funding',
    methods: ['POST'],
    port: 4795,
  },
  {
    path: '/api/storefront/customer/wallet/piggyvest-plan',
    methods: ['GET'],
    port: 4795,
  },
] as const;

export function customerFundingRoutes() {
  return {
    proxyRoutes: routes.map(({ path, methods }) => ({
      src: `^${path}$`,
      dest: `https://staging-auth.ogabassey.com${path}`,
      methods: [...methods],
    })),
    nginxLocations: routes
      .map(
        ({ path, methods, port }) => `location = ${path} {
  if ($request_method !~ ^(${methods.join('|')})$) { return 405; }
  client_max_body_size 16k;
  proxy_pass http://127.0.0.1:${port};
  proxy_set_header Host staging.ogabassey.com;
  proxy_set_header X-Forwarded-Host staging.ogabassey.com;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Port 443;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Forwarded "";
  proxy_set_header x-middleware-subrequest "";
  proxy_hide_header Cache-Control;
  add_header Cache-Control "no-store" always;
  access_log off;
}`
      )
      .join('\n\n'),
  };
}
