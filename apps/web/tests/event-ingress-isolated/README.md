Run this fixture only against the dedicated empty Supabase stack for event ingress. It expects the event pipeline tables, queue, and event ingress migrations already applied, along with the two synthetic merchants in `context.sql`. The runner applies the minimal public storefront context schema to that same container and leaves its uniquely tagged synthetic rows for inspection.

From this directory, with app dependencies installed:

```sh
node run.mjs /path/to/local-status.json /path/to/stack/supabase/signing_keys.json
```

Use only the dedicated stack's local status JSON and generated test keys. The runner strips inherited environment configuration, uses API port 54371 and a loopback Next HTTP server on port 54381, and refuses fetches to other origins. It uses the actual analytics handler, cookie context, context resolver, signer, Supabase client, and event persistence. It does not import the application proxy, boot the production build, or run workers, so it does not test CSRF middleware, deployment configuration, or external delivery.
