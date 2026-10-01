export const builderAiEditTestFixture = {
  candidate: {
    candidateConfig: {
      content: [
        {
          props: {
            id: 'hero-1',
            subtitle: 'Thoughtful pieces for everyday life',
            title: 'Welcome to Acme',
          },
          type: 'Hero',
        },
        {
          props: { id: 'newsletter-1', title: 'Stay in touch' },
          type: 'Newsletter',
        },
      ],
      root: { legacyRootFlag: true, title: 'Home' },
      theme: { colors: { primary: '#111111' } },
      zones: {
        aside: [{ props: { text: 'Nested legacy content' }, type: 'Text' }],
      },
    },
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    contractVersion: 'builder-ai-edit-v1',
    operations: [
      {
        componentId: 'hero-1',
        kind: 'update_component',
        patch: { componentType: 'Hero', title: 'Welcome to Acme' },
      },
    ],
    summary: 'Update the hero copy',
    warnings: [],
  },
  request: {
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    contractVersion: 'builder-ai-edit-v1',
    currentConfig: {
      content: [
        {
          props: {
            id: 'hero-1',
            subtitle: 'Thoughtful pieces for everyday life',
            title: 'Welcome',
          },
          type: 'Hero',
        },
        {
          props: { id: 'newsletter-1', title: 'Stay in touch' },
          type: 'Newsletter',
        },
      ],
      root: { legacyRootFlag: true, title: 'Home' },
      theme: { colors: { primary: '#111111' } },
      zones: {
        aside: [{ props: { text: 'Nested legacy content' }, type: 'Text' }],
      },
    },
    merchantId: '11111111-1111-4111-8111-111111111111',
    prompt: 'Make the hero more welcoming',
  },
};
