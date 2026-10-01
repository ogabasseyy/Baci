import type { NextRequest } from 'next/server';
import { handleBuilderAiEditRequest } from '../ai-edit/handle-builder-ai-edit-request';

// Kept for installed web/mobile clients that still send the legacy unversioned
// request. Endpoint versioning, rather than a missing-field heuristic, keeps
// the v1 candidate contract unambiguous.
export function POST(request: NextRequest): Promise<Response> {
  return handleBuilderAiEditRequest(request, { mode: 'legacy' });
}
