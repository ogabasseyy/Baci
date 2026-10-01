import { builderAiEditContract } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getIconOptions } from '@/components/builder/icon-registry';

describe('Builder AI Feature icon parity', () => {
  it('accepts the real Puck default icon and rejects values outside its registry', () => {
    const options = getIconOptions();
    const defaultIcon = 'headphones';

    expect(options?.map((option) => option.value)).toContain(defaultIcon);
    expect(defaultIcon).toBe('headphones');
    expect(
      builderAiEditContract.modelPlanSchema.safeParse({
        operations: [
          {
            componentId: 'features-1',
            kind: 'update_component',
            patch: {
              componentType: 'Features',
              features: [
                {
                  description: 'Available help when needed.',
                  icon: defaultIcon,
                  title: 'Support',
                },
              ],
            },
          },
        ],
        status: 'proposed',
        summary: 'Preserve the default support icon',
      }).success
    ).toBe(true);
    expect(
      builderAiEditContract.modelPlanSchema.safeParse({
        operations: [
          {
            componentId: 'features-1',
            kind: 'update_component',
            patch: {
              componentType: 'Features',
              features: [
                {
                  description: 'Unsupported icon values must fail closed.',
                  icon: 'not-in-the-registry',
                  title: 'Unknown',
                },
              ],
            },
          },
        ],
        status: 'proposed',
        summary: 'Reject an unknown icon',
      }).success
    ).toBe(false);
  });
});
