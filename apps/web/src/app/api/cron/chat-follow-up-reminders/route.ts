import { NextResponse } from 'next/server';
import { sweepChatFollowUpReminders } from '@/lib/chatwoot/chat-follow-up-reminder-sweep';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Pushes the chat follow-up reminders that came due. Runs every few minutes
 * from the cron schedule; the secret is the only way in.
 */
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sweepChatFollowUpReminders();
    if (!result.ok) {
      logger.error({
        message: 'Chat follow-up reminder sweep could not start',
        code: result.code,
      });
      return NextResponse.json(
        { error: 'Follow-up reminder sweep failed', code: result.code },
        { status: result.code === 'not_configured' ? 503 : 500 }
      );
    }
    return NextResponse.json(result.summary);
  } catch {
    logger.error({ message: 'Chat follow-up reminder sweep failed' });
    return NextResponse.json(
      { error: 'Follow-up reminder sweep failed' },
      { status: 500 }
    );
  }
}
