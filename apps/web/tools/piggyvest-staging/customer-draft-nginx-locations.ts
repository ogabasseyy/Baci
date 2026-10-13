const CUSTOMER_DRAFT_LOCATIONS = [
  {
    methods: 'GET|POST',
    path: '/api/storefront/customer/savings/drafts',
  },
  {
    methods: 'GET|POST',
    path: '/api/storefront/customer/savings/drafts/policy',
  },
  {
    methods: 'GET',
    path: '/api/storefront/customer/savings/drafts/catalogue',
  },
] as const;

export function renderCustomerDraftNginxLocations(): string {
  return `${CUSTOMER_DRAFT_LOCATIONS.map(
    ({ methods, path }) => `location = ${path} {
  if ($request_method !~ ^${methods.includes('|') ? `(${methods})` : methods}$) { return 405; }
  proxy_pass http://127.0.0.1:4792;
  proxy_set_header Host staging.ogabassey.com;
  proxy_set_header X-Forwarded-Host staging.ogabassey.com;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Port 443;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Forwarded "";
  proxy_set_header x-middleware-subrequest "";
  access_log off;
}`
  ).join('\n\n')}\n`;
}
