import { afterEach, describe, expect, it, vi } from 'vitest';
import { logBuilderAiEvent } from './log-builder-ai-event';

describe('logBuilderAiEvent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits only allowlisted metadata without prompts, configs, or provider bodies', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logBuilderAiEvent('builder_ai_timeout', {
      merchantId: 'merchant-1',
      provider: 'cerebras:gemma-4-31b',
      requestId: 'request-1',
      userId: 'user-1',
    });

    expect(info).toHaveBeenCalledWith('builder_ai_event', {
      event: 'builder_ai_timeout',
      merchantId: 'merchant-1',
      provider: 'cerebras:gemma-4-31b',
      requestId: 'request-1',
      userId: 'user-1',
    });
  });
});
