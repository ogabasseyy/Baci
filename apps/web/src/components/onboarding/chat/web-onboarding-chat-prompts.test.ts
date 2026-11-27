import { describe, expect, it } from 'vitest';
import {
  getWebQuickRepliesForStep,
  getWebStepInputConfig,
} from './web-onboarding-chat-prompts';

describe('web-onboarding-chat-prompts', () => {
  it('returns auth choices and hides suggested link chip when slug was rejected', () => {
    const authReplies = getWebQuickRepliesForStep({
      step: 'auth_choice',
      suggestedNames: [],
      logoPreviewSource: null,
      isCustomizingSlug: false,
      isLaunching: false,
    });
    expect(authReplies.map((r) => r.id)).toEqual([
      'auth:google',
      'auth:email',
      'auth:magic_link',
    ]);

    const rejectedSlugReplies = getWebQuickRepliesForStep({
      step: 'slug',
      suggestedNames: [],
      logoPreviewSource: null,
      isCustomizingSlug: true,
      hasRejectedSlug: true,
      isLaunching: false,
    });
    expect(rejectedSlugReplies).toEqual([]);
  });

  it('returns masked password input config on auth_password', () => {
    expect(getWebStepInputConfig('auth_password', false).inputType).toBe(
      'password'
    );
  });
});
