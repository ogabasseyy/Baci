// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
import { describe, expect, it } from 'vitest';

describe('production MCP proxy configuration', () => {
  it('keeps guest carts in a stable private volume owned by the server user', () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');
    const dockerfile = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    expect(compose).toContain('mcp-guest-carts:/var/lib/baci/guest-carts');
    expect(compose).toContain('name: ogabassey-mcp-guest-carts');
    expect(dockerfile).toContain(
      'ENV MCP_GUEST_CART_DIRECTORY=/var/lib/baci/guest-carts'
    );
    expect(dockerfile).toContain('chown node:node /var/lib/baci/guest-carts');
    expect(dockerfile).toContain('chmod 700 /var/lib/baci/guest-carts');
    expect(dockerfile).toContain('USER node');
  });

  it('pins the guest-cart writer to a single replica', () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');

    expect(compose).toContain('replicas: 1');
    expect(compose).toContain(
      'MCP_GUEST_CART_DIRECTORY=/var/lib/baci/guest-carts'
    );
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

  it('gives shutdown longer than the drain deadline to release the lock', async () => {
    const compose = readFileSync(join(directory, 'docker-compose.yml'), 'utf8');
    const { SHUTDOWN_DRAIN_TIMEOUT_MS } = await import(
      './server-shutdown'
    );
    // The app forces lock release when the drain deadline fires; compose
    // must not SIGKILL first (the 10s default ties the deadline exactly,
    // so jitter decides). Pin the relationship, not just the value, so a
    // future deadline bump fails here instead of redeploying into a stale
    // lock wait.
    const match = compose.match(/stop_grace_period:\s*(\d+)(s|m)/);
    expect(match).not.toBeNull();
    const graceMs =
      Number(match?.[1]) * (match?.[2] === 'm' ? 60_000 : 1000);
    expect(graceMs).toBeGreaterThan(SHUTDOWN_DRAIN_TIMEOUT_MS);
  });
});
