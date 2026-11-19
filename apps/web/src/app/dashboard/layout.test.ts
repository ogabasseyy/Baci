import { describe, expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => vi.fn());
vi.mock('next/server', () => ({ connection }));
vi.mock('@/app/app-sans-font', () => ({ AppSansFont: () => null }));
vi.mock('@/components/passkey-enrollment-prompt', () => ({
  PasskeyEnrollmentPrompt: () => null,
}));
vi.mock('./auth-guard', () => ({ DashboardAuthGuard: () => null }));
vi.mock('./loading', () => ({ default: () => null }));

describe('dashboard document rendering', () => {
  it('waits for the request before generating a nonce-bearing document', async () => {
    const layout = await import('./layout');
    expect(layout).toHaveProperty('instant', false);
    await expect(layout.generateViewport()).resolves.toEqual({
      width: 'device-width',
      initialScale: 1,
      maximumScale: 5,
      userScalable: true,
      viewportFit: 'cover',
      themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#0F0F0F' },
      ],
      colorScheme: 'light dark',
    });
    expect(connection).toHaveBeenCalledOnce();
  });
});
