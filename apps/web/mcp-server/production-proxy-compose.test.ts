import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production MCP proxy configuration', () => {
  it('requires an explicit trusted-proxy choice behind the loopback binding', () => {
    const compose = readFileSync(join(process.cwd(), 'mcp-server/docker-compose.yml'), 'utf8');

    expect(compose).toContain('"127.0.0.1:8787:8787"');
    expect(compose).toContain(
      'MCP_TRUST_PROXY_REAL_IP=${MCP_TRUST_PROXY_REAL_IP:?Set explicitly after verifying the production reverse proxy}'
    );
    expect(compose).not.toContain('MCP_TRUST_PROXY_REAL_IP=${MCP_TRUST_PROXY_REAL_IP:-false}');
  });
});
