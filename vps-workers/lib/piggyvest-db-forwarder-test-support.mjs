import { connect, createServer } from 'node:net';
import { createDbForwarder } from './piggyvest-db-forwarder.mjs';

export function noop() {
  // intentionally empty
}
export const cleanups = [];
export async function runCleanups() {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
}

export async function startFakeUpstream() {
  const connections = [];
  const received = [];
  const server = createServer((socket) => {
    connections.push(socket);
    socket.on('error', noop);
    socket.on('data', (chunk) => {
      received.push(chunk);
      socket.write(Buffer.concat([Buffer.from('Secho:'), chunk]));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(
    () =>
      new Promise((r) => {
        for (const s of connections) s.destroy();
        server.close(() => r());
      })
  );
  return { port: server.address().port, connections, received };
}

export async function startForwarder({ upstreamPort, limits, logs = [] }) {
  const forwarder = createDbForwarder({
    listenPort: 0,
    listenHost: '127.0.0.1',
    upstream: { host: '127.0.0.1', port: upstreamPort, family: 4 },
    limits,
    log: (line) => logs.push(line),
  });
  const port = await forwarder.listen();
  cleanups.push(() => forwarder.close());
  return { forwarder, port, logs };
}

export function client(port) {
  const socket = connect(port, '127.0.0.1');
  const chunks = [];
  socket.on('data', (c) => chunks.push(c));
  socket.on('error', noop);
  const closed = new Promise((r) => socket.on('close', r));
  cleanups.push(async () => socket.destroy());
  return {
    socket,
    chunks,
    closed,
    text: () => Buffer.concat(chunks).toString(),
  };
}

export const until = async (predicate, ms = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startScripted(onConnection) {
  const connections = [];
  const server = createServer((socket) => {
    connections.push(socket);
    socket.on('error', noop);
    onConnection(socket);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(
    () =>
      new Promise((r) => {
        for (const s of connections) s.destroy();
        server.close(() => r());
      })
  );
  return { port: server.address().port, connections };
}
