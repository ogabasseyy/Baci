import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startAuthLoopback } from './auth-loopback';

it('forwards OAuth requests to the private socket with a fixed host and sanitized proxy headers', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'auth-loopback-')));
  const socketPath = join(dir, 'auth.sock');
  const backend = createServer((req, res) => {
    res.setHeader('set-cookie', ['a=1; HttpOnly', 'b=2; HttpOnly']);
    res.end(
      JSON.stringify({
        host: req.headers.host,
        forwarded: req.headers['x-forwarded-for'],
        origin: req.headers.origin,
        url: req.url,
      })
    );
  });
  await new Promise<void>((resolve) => backend.listen(socketPath, resolve));
  const proxy = await startAuthLoopback({ socketPath, port: 0 });
  try {
    const result = await fetch(`${proxy.origin}/auth?state=synthetic`, {
      headers: { 'x-forwarded-for': 'attacker', origin: 'https://chatgpt.com' },
    });
    expect(await result.json()).toEqual({
      host: 'builder-auth.usebaci.com',
      origin: 'https://chatgpt.com',
      url: '/auth?state=synthetic',
    });
    expect(result.headers.getSetCookie()).toHaveLength(2);
    expect((await fetch(`${proxy.origin}/builder/mcp`)).status).toBe(404);
    expect(
      (await fetch(`${proxy.origin}/disconnect`, { method: 'POST' })).status
    ).toBe(404);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
