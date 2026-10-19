import { MAX_AI_EDIT_BODY_BYTES } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { isBuilderPreviewRenderEvent } from './is-builder-preview-render-event';

describe('isBuilderPreviewRenderEvent', () => {
  it('identifies the render event in object and native JSON-string message data', () => {
    expect(
      isBuilderPreviewRenderEvent(
        new MessageEvent('message', {
          data: { type: 'baci.builder-preview.render' },
        })
      )
    ).toBe(true);
    expect(
      isBuilderPreviewRenderEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'baci.builder-preview.render' }),
        })
      )
    ).toBe(true);
  });

  it('does not classify host or oversized native messages as builder render events', () => {
    const oversized =
      JSON.stringify({ type: 'baci.builder-preview.render' }) +
      'x'.repeat(MAX_AI_EDIT_BODY_BYTES);

    expect(
      isBuilderPreviewRenderEvent(
        new MessageEvent('message', { data: { type: 'host.analytics' } })
      )
    ).toBe(false);
    expect(
      isBuilderPreviewRenderEvent(
        new MessageEvent('message', { data: oversized })
      )
    ).toBe(false);
  });
});
