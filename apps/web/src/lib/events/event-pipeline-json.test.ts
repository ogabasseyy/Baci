import { describe, expect, it } from 'vitest';
import { toEventPipelineJson } from './event-pipeline-database';

describe('toEventPipelineJson', () => {
  it('converts plain JSON values and rejects non-JSON values', () => {
    expect(
      toEventPipelineJson({ id: 'evt-1', values: [1, true, null] })
    ).toEqual({ id: 'evt-1', values: [1, true, null] });
    expect(() => toEventPipelineJson(new Date())).toThrow(
      'event_pipeline_non_json_value'
    );
  });

  it('rejects cyclic values', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => toEventPipelineJson(cyclic)).toThrow(
      'event_pipeline_non_json_value'
    );
  });
});
