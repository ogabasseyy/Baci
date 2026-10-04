export function resolveRuntimeJourneyBrowserConfiguration(port: unknown): {
  port: 4181 | 4183;
  origin: 'http://127.0.0.1:4181' | 'http://127.0.0.1:4183';
} {
  if (port !== 4181 && port !== 4183)
    throw new Error('Pinned synthetic browser port required');
  return { port, origin: `http://127.0.0.1:${port}` };
}
