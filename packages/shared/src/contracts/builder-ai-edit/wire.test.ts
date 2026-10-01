import { describe, expect, it } from 'vitest';
import { builderAiEditContract } from './index';

const request = {
  clientRequestId: '00000000-0000-4000-8000-000000000001',
  contractVersion: 'builder-ai-edit-v1',
  currentConfig: {
    content: [{ props: { id: 'hero-1', title: 'Welcome' }, type: 'Hero' }],
    root: { title: 'Home', legacyRootFlag: true },
    theme: { colors: { primary: '#111111' } },
    zones: { aside: [{ props: { text: 'Nested' }, type: 'Text' }] },
  },
  merchantId: '11111111-1111-4111-8111-111111111111',
  prompt: 'Make the hero more welcoming',
};

describe('builder AI edit persisted wire contract', () => {
  it('preserves neutral content, root, zones, and theme without closing legacy data', () => {
    const result = builderAiEditContract.requestSchema.safeParse(request);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentConfig).toEqual(request.currentConfig);
    }
  });

  it('rejects unknown wire keys, invalid IDs, and overlong prompts', () => {
    expect(
      builderAiEditContract.requestSchema.safeParse({
        ...request,
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      builderAiEditContract.requestSchema.safeParse({
        ...request,
        clientRequestId: 'not-a-uuid',
      }).success
    ).toBe(false);
    expect(
      builderAiEditContract.requestSchema.safeParse({
        ...request,
        prompt: 'x'.repeat(1001),
      }).success
    ).toBe(false);
  });

  it('defaults props for legacy persisted builder blocks', () => {
    const result = builderAiEditContract.requestSchema.safeParse({
      ...request,
      currentConfig: { ...request.currentConfig, content: [{ type: 'Hero' }] },
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.currentConfig.content[0]?.props).toEqual({});
  });
});
