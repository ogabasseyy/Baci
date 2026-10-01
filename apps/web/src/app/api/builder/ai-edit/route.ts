import type { NextRequest } from 'next/server';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

export function POST(request: NextRequest): Promise<Response> {
  return handleBuilderAiEditRequest(request);
}
