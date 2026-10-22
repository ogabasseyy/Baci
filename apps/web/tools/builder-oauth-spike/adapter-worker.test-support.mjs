/** Child-process SDK v2 transport proof. Has no upstream OAuth client or token. */

import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:https';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import { loadCandidate } from './candidate-runtime.test-support.mjs';

const { createLocalJWKSet, jwtVerify } = await loadCandidate('jose');

const config = JSON.parse(process.argv[2]);
const gateway = new URL(config.gateway);
if (
  gateway.protocol !== 'https:' ||
  gateway.hostname !== '127.0.0.1' ||
  gateway.pathname !== '/execute'
)
  throw new Error('Non-fixture gateway');
const keys = createLocalJWKSet({ keys: [config.publicKey] });
function forward(token) {
  return new Promise((resolve, reject) => {
    const req = request(
      gateway,
      {
        agent: false,
        rejectUnauthorized: false,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (value) => (body += value));
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error('Gateway rejected'));
          else resolve(body);
        });
      }
    );
    req.setTimeout(4000, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end('{}');
  });
}
const server = createServer(
  { key: readFileSync(config.keyFile), cert: readFileSync(config.certFile) },
  async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    try {
      if (!token) throw new Error('Missing token');
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ['ES256'],
      });
      if (!String(payload.scope).split(' ').includes('storefront.read'))
        throw new Error('Missing scope');
    } catch {
      res.writeHead(401);
      res.end();
      return;
    }
    const mcp = new McpServer({
      name: 'local-builder-proof',
      version: '0.0.0',
    });
    mcp.registerTool(
      'inspect_builder_boundary',
      { description: 'Local audience and gateway proof', inputSchema: {} },
      async () => ({ content: [{ type: 'text', text: await forward(token) }] })
    );
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.once('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  }
);
server.listen(0, '127.0.0.1', () =>
  process.send({
    port: server.address().port,
    environmentKeys: Object.keys(process.env),
  })
);
process.on('message', (message) => {
  if (message === 'stop') server.close(() => process.exit(0));
});
