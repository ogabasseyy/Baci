import type { NextRequest } from 'next/server';
import { runAmendmentCommand } from './command';

type Context = { params: Promise<{ id: string }> };

export function GET(request: NextRequest, context: Context) {
  return runAmendmentCommand(request, context, 'read');
}

export function POST(request: NextRequest, context: Context) {
  return runAmendmentCommand(request, context, 'confirm');
}
