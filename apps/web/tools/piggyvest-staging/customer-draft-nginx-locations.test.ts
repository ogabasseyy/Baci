import { describe, expect, it } from 'vitest';
import { renderCustomerDraftNginxLocations } from './customer-draft-nginx-locations';

describe('renderCustomerDraftNginxLocations', () => {
  it('renders only the three approved paths with fixed trusted upstream headers', () => {
    expect(
      renderCustomerDraftNginxLocations()
    ).toBe(`location = /api/storefront/customer/savings/drafts {
  if ($request_method !~ ^(GET|POST)$) { return 405; }
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
}

location = /api/storefront/customer/savings/drafts/policy {
  if ($request_method !~ ^(GET|POST)$) { return 405; }
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
}

location = /api/storefront/customer/savings/drafts/catalogue {
  if ($request_method !~ ^GET$) { return 405; }
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
}
`);
  });

  it('does not render wildcard locations, webhook paths, or auth overrides', () => {
    const locations = renderCustomerDraftNginxLocations();

    expect(locations).not.toContain('location /api/');
    expect(locations).not.toContain('api/webhooks/piggyvest');
    expect(locations).not.toContain('piggyvest/intake');
    expect(locations).not.toContain('auth_basic off');
    expect(locations).not.toContain('satisfy any');
    expect(locations).not.toContain('$proxy_add_x_forwarded_for');
    expect(locations.match(/access_log off;/g)).toHaveLength(3);
    expect(locations.match(/proxy_set_header Forwarded "";/g)).toHaveLength(3);
    expect(
      locations.match(/proxy_set_header x-middleware-subrequest "";/g)
    ).toHaveLength(3);
  });
});
