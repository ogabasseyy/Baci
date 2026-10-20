// Colocated regression battery for .github/actions/pnpm-install-cached.
// The shared allowlist/env-hardening suite lives beside setup-pnpm-store;
// importing it here executes the full battery against THIS action's files
// too (INSTALL_ACTION assertions run in this process), so hardened paths in
// either action cannot change without adjacent regression protection.
import '../setup-pnpm-store/setup-pnpm-store-allowlist.test.mjs';
