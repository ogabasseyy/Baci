import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
import { sanitizeRelativeRedirectPath } from '@/lib/auth-redirect';

/**
 * Exit Preview API Route
 * Disables Next.js Draft Mode and redirects the user.
 * 2026 Best Practice: Async draftMode() cleanup.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawCallbackUrl = searchParams.get('callbackUrl');
  const callbackUrl = sanitizeRelativeRedirectPath(rawCallbackUrl, '/blog');

  // Disable Draft Mode
  const draft = await draftMode();
  draft.disable();

  // Redirect back to either the specified callback or the blog home
  // biome-ignore lint/suspicious/noExplicitAny: Next.js Typed Routes requires casting dynamic URLs
  redirect(callbackUrl as any);
}
