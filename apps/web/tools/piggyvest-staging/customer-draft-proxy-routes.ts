export function customerDraftProxyRoutes() {
  const basePath = '/api/storefront/customer/savings/drafts';
  return [
    { path: basePath, methods: ['GET', 'POST'] },
    { path: `${basePath}/policy`, methods: ['GET', 'POST'] },
    { path: `${basePath}/catalogue`, methods: ['GET'] },
  ].map(({ path, methods }) => ({
    src: `^${path}$`,
    dest: `https://staging-auth.ogabassey.com${path}`,
    methods,
  }));
}
