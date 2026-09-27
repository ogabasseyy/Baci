import { NextResponse } from 'next/server';
import { JumiaApiError, jumiaErrorResponse } from '@/lib/jumia/helpers';
import { logger } from '@/lib/logger';

/** Converts reconciliation failures into the route's stable error response. */
export function handleJumiaFeedProcessingFailure(args: {
  error: unknown;
  feedId: string;
}): Response {
  if (args.error instanceof JumiaApiError) {
    return jumiaErrorResponse(args.error);
  }
  logger.error({
    message: 'Failed to reconcile Jumia feed',
    error: args.error,
    feed_id: args.feedId,
  });
  return NextResponse.json(
    { error: 'Failed to reconcile Jumia feed' },
    { status: 502 }
  );
}
