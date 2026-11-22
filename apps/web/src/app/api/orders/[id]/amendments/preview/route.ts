import type { NextRequest } from 'next/server';
import { runAmendmentCommand } from '../command';

export function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return runAmendmentCommand(request, context, 'preview');
}
