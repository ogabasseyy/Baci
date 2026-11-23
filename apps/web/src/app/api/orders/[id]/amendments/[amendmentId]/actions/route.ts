import type { NextRequest } from 'next/server';
import { runAmendmentCommand } from '../../command';

type Context = { params: Promise<{ id: string; amendmentId: string }> };

export function POST(request: NextRequest, context: Context) {
  return runAmendmentCommand(request, context, 'action');
}
