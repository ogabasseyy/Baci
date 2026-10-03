// Empty `server-only` stand-in, used ONLY by the pre-start stage CLI via
// merchant-image-pilot-stage.tsconfig.json. The real `server-only` package
// throws outside React Server Components, which is correct for app code but
// blocks the CLI from reusing the exact request-time staging loader. This
// stub is scoped to that tsconfig (Next builds and vitest never see it);
// the CLI runs server-side-only operator tooling, so the boundary the
// package guards does not apply. Do not import this file anywhere else.
export {};
