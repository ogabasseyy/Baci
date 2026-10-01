import type { BuilderData } from '@baci/shared/contracts';
import { NextResponse } from 'next/server';
import { prepareBuilderAiEditPrompt } from './prepare-builder-ai-edit-prompt';

type BuilderAiPromptResponse = { prompt: string } | { response: Response };

export function prepareBuilderAiEditPromptResponse({
  currentConfig,
  prompt,
  requestId,
}: {
  currentConfig: BuilderData;
  prompt: string;
  requestId: string;
}): BuilderAiPromptResponse {
  try {
    const prepared = prepareBuilderAiEditPrompt({ currentConfig, prompt });
    if (prepared.ok) return { prompt: prepared.prompt };
    return {
      response: NextResponse.json(
        { code: prepared.code, error: prepared.error, requestId },
        { status: 413 }
      ),
    };
  } catch {
    return {
      response: NextResponse.json(
        { error: 'Internal server error', requestId },
        { status: 500 }
      ),
    };
  }
}
