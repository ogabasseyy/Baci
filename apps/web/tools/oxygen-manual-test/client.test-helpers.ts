import { afterEach, expect, vi } from 'vitest';
import { renderProbeUi } from './ui';

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.resetModules();
});
export async function setup(replies: unknown[], creationLocked = false) {
  document.documentElement.innerHTML = renderProbeUi({
    origin: 'http://127.0.0.1:3417',
    csrf: 'fixture',
    environment: 'production',
    configured: true,
    creationLocked,
  });
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(replies.shift()), { status: 200 })
  );
  vi.stubGlobal('fetch', fetcher);
  await import('./client.js');
  return fetcher;
}
export async function click(id: string) {
  document.querySelector<HTMLButtonElement>(id)?.click();
  await vi.waitFor(() =>
    expect(document.querySelector('#status')?.textContent).not.toBe(
      'Sending your manual request…'
    )
  );
}
