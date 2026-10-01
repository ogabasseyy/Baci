import type { BuilderData } from '@baci/shared/contracts';
import {
  BuilderAiPromptProjectionTooLargeError,
  buildBuilderAiEditPrompt,
} from './build-builder-ai-edit-prompt';

type PreparedBuilderAiEditPrompt =
  | { ok: true; prompt: string }
  | {
      code: 'builder_ai_prompt_too_large';
      error: 'Builder AI request is too large';
      ok: false;
    };

export function prepareBuilderAiEditPrompt({
  currentConfig,
  prompt,
}: {
  currentConfig: BuilderData;
  prompt: string;
}): PreparedBuilderAiEditPrompt {
  try {
    return {
      ok: true,
      prompt: buildBuilderAiEditPrompt({ currentConfig, prompt }),
    };
  } catch (error) {
    if (!(error instanceof BuilderAiPromptProjectionTooLargeError)) throw error;
    return {
      code: 'builder_ai_prompt_too_large',
      error: 'Builder AI request is too large',
      ok: false,
    };
  }
}
