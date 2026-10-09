// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
import { describe, expect, it } from 'vitest';

describe('production MCP proxy configuration', () => {
  it('persists nothing locally: guest carts live in Postgres', () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');
    const dockerfile = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    // No cart volume, no cart directory, no replica pin: concurrent
    // writers serialize through the Postgres row version gate.
    expect(compose).not.toContain('MCP_GUEST_CART_DIRECTORY');
    expect(compose).not.toContain('mcp-guest-carts');
    expect(compose).not.toContain('replicas:');
    expect(compose).toContain('read_only: true');
    expect(dockerfile).not.toContain('MCP_GUEST_CART_DIRECTORY');
    expect(dockerfile).not.toContain('/var/lib/baci/guest-carts');
    expect(dockerfile).toContain('USER node');
  });

  it('passes the configured GIG quote deadline into the production container', () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');

    expect(compose).toContain(
      'GIGL_QUOTE_TIMEOUT_MS=${GIGL_QUOTE_TIMEOUT_MS:-5000}'
    );
  });

  it('requires an explicit trusted-proxy choice behind the loopback binding', () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('"127.0.0.1:8787:8787"');
    expect(compose).toContain(
      'MCP_TRUST_PROXY_REAL_IP=${MCP_TRUST_PROXY_REAL_IP:?Set explicitly after verifying the production reverse proxy}'
    );
    expect(compose).not.toContain(
      'MCP_TRUST_PROXY_REAL_IP=${MCP_TRUST_PROXY_REAL_IP:-false}'
    );
  });

  it('gives shutdown longer than the drain deadline to finish', async () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');
    const { SHUTDOWN_DRAIN_TIMEOUT_MS } = await import(
      './server-shutdown'
    );
    // The app forces the exit when the drain deadline fires; compose must
    // not SIGKILL first (the 10s default ties the deadline exactly, so
    // jitter decides). Pin the relationship, not just the value, so a
    // future deadline bump fails here instead of redeploying into
    // truncated drains.
    const match = compose.match(/stop_grace_period:\s*(\d+)(s|m)/);
    expect(match).not.toBeNull();
    const graceMs =
      Number(match?.[1]) * (match?.[2] === 'm' ? 60_000 : 1000);
    expect(graceMs).toBeGreaterThan(SHUTDOWN_DRAIN_TIMEOUT_MS);
  });
});
