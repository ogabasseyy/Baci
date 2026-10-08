# Isolated savings runtime validation

Owner approved the narrow `apps/web/src/env.ts` change on 20 September 2026.

The server-only `hosted-savings-drafts` worker profile requires production build mode, the explicit hosted-draft flag, and exact staging app and Supabase URLs. It accepts the public anon key, not privileged database or payment credentials. Credential-shaped environment names are rejected before unknown fields are stripped. Customer routes independently verify the existing public-key hash, authenticated identity, synthetic merchant binding, and CSRF requirements.

Normal application validation is unchanged by this profile. No `.env` files, production credentials, migrations, or webhook receiver were changed by this slice. Staging returns only validated public client configuration and noncredential defaults required by existing typed consumers. Privileged getters remain unavailable.

Verified locally: 151 environment/schema regression tests pass, six root typecheck tasks pass, and changed environment files pass Biome. Independent Terra review found a raw-environment fallback gap; the credential-name guard and regression cases address it. Root lint still reports six errors in other existing work.

This is not deployment evidence. The hosted customer draft API still returned 404 at the last external check. The gateway has a 24-hour lease starting 20 September 2026 at 11:24:05 UTC; it is not a permanent activation. Next gates are the isolated source snapshot/build, exact-path private ingress verification, and staging-only deployment followed by authenticated customer-flow testing. Preserve the working standalone webhook receiver throughout.

The first isolated VPS build verified 21,237 source files and installed dependencies successfully. Compilation then exposed an existing explicit `runtime = 'nodejs'` export in the Next webhook route, incompatible with Cache Components. Removed only that redundant export, retaining Next's default Node runtime and all handler behavior. A red/green colocated regression covers the unsupported configuration. This does not change the independently deployed Vercel receiver. See the official [route segment configuration contract](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config).
