import { describe, expect, it } from 'vitest';
import { EVENT_PIPELINE_FUNCTION_NAMES } from './event-pipeline-function-names';

describe('EVENT_PIPELINE_FUNCTION_NAMES', () => {
  it('allows only the audited event pipeline RPC names', () => {
    expect(EVENT_PIPELINE_FUNCTION_NAMES).toHaveLength(19);
    expect(EVENT_PIPELINE_FUNCTION_NAMES).toContain('enqueue_domain_event_v1');
  });
});
