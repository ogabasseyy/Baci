# Dashboard CSP smoke check

Start a production-mode web build against the isolated local Supabase fixture.
Sign in using a disposable merchant account. From the web package, run:

```sh
node tools/qa/check-dashboard-csp.mjs http://localhost:3946/dashboard/marketing/discount-codes
```

Pass the authenticated local request's Cookie header through the
`BACI_LOCAL_DASHBOARD_COOKIE` environment variable. Keep the cookie out of
shell history and logs. The checker accepts loopback URLs and refuses redirects.
Run it before releasing changes to dashboard rendering or CSP. It checks actual
HTML twice and requires every executable inline script to carry its response's
nonce. Each response must have a different nonce. The Vitest layout test covers
the viewport contract. The smoke check requires a running production build and
an authenticated fixture, so it is run separately from Vitest.

Open the same dashboard in a browser with CSP enabled. Verify that Create Code
opens its dialog and that the console reports no blocked bootstrap scripts.
Dashboard documents render on request, so navigation can block while the
viewport is generated. Storefront rendering is outside this change.
