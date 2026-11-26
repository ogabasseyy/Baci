import {
  DEFAULT_BRAND_COLORS,
  type OnboardingChatData,
} from '@baci/shared/onboarding-chat';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMessageBubble } from './ChatMessageBubble';

const DATA: OnboardingChatData = {
  firstName: 'Ada',
  lastName: 'Okafor',
  phone: '+234 801 234 5678',
  businessName: 'Kicks Hub',
  businessType: 'fashion',
  otherBusinessType: '',
  country: 'NG',
  slug: 'kicks-hub',
  slugIsCustom: false,
  logoUrl: 'https://cdn.usebaci.com/logo.png',
  brandColors: DEFAULT_BRAND_COLORS,
};

describe('ChatMessageBubble', () => {
  it('renders logo preview and color swatches when provided', () => {
    render(
      <ol>
        <ChatMessageBubble
          data={DATA}
          message={{
            id: 'm-1',
            role: 'assistant',
            text: 'Here is your logo',
            logoPreviewUri: 'https://cdn.usebaci.com/logo.png',
            brandColors: DEFAULT_BRAND_COLORS,
          }}
        />
      </ol>
    );

    expect(screen.getByAltText('Store logo preview')).toBeTruthy();
    expect(screen.getByText('Primary')).toBeTruthy();
    expect(screen.getByText('Accent')).toBeTruthy();
  });

  it('renders structured summary details when isSummary is true', () => {
    render(
      <ol>
        <ChatMessageBubble
          data={DATA}
          message={{
            id: 'm-2',
            role: 'assistant',
            text: 'Recap:',
            isSummary: true,
          }}
        />
      </ol>
    );

    expect(screen.getByText('Kicks Hub')).toBeTruthy();
    expect(screen.getByText('kicks-hub.usebaci.com')).toBeTruthy();
  });
});
