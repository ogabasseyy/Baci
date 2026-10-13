import { describe, expect, it } from 'vitest';
import { postGenerateDva } from './generate-dva-test-support';

describe('POST /api/orders/[id]/generate-dva route contract', () => {
  it('exposes the route covered by the focused access and provisioning suites', () => {
    expect(postGenerateDva).toBeTypeOf('function');
  });
});
