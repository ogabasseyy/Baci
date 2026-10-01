import { describe, expect, it } from 'vitest';
import {
  isCurrentBuilderAiRequest,
  type LegacyBuilderAiResponse,
} from './builder-ai-request';

describe('isCurrentBuilderAiRequest', () => {
  it('rejects a prior request after a later request starts', () => {
    const sequence = { current: 2 };

    expect(isCurrentBuilderAiRequest(sequence, 1)).toBe(false);
    expect(isCurrentBuilderAiRequest(sequence, 2)).toBe(true);
  });
});

describe('legacy builder AI response', () => {
  it('keeps the legacy response source-compatible as a config object', () => {
    const legacy: LegacyBuilderAiResponse = {
      config: { content: [], root: { title: 'Home' } },
    };

    expect(legacy.config.root.title).toBe('Home');
  });
});
