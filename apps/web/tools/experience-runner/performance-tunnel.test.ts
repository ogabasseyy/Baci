import { connect } from 'node:net';
import { expect, it } from 'vitest';
import { startPerformanceTunnel } from './performance-tunnel';

it('blocks arbitrary CONNECT destinations and ordinary HTTP without DNS or egress', async () => {
  const proxy = await startPerformanceTunnel(
    new Map([
      ['shop.synthetic.test:443', 4100],
      ['artifacts.baci-cwv.invalid:443', 4101],
    ])
  );
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(new URL(proxy.origin).port), '127.0.0.1');
      socket.on('error', reject);
      socket.on('data', (data) => {
        resolve(data.toString());
        socket.destroy();
      });
      socket.on('connect', () =>
        socket.write(
          'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'
        )
      );
    });
    expect(result).toContain('403 Forbidden');
    expect((await fetch(proxy.origin)).status).toBe(403);
    expect(proxy.blocked()).toBe(2);
  } finally {
    await proxy.close();
  }
});
