import { escapeHtmlAttribute as sanitizeHtmlText } from '@/lib/sanitize';
import type { OnboardingDecision, OnboardingStage } from './policy';

export function buildOnboardingEmail(input: {
  businessName: string;
  decision: Extract<OnboardingDecision, { kind: 'send' }>;
  stage: OnboardingStage;
  appUrl: string;
  optOutUrl: string;
}) {
  const { businessName, decision, stage, optOutUrl, appUrl } = input;
  const subject =
    stage === 'welcome'
      ? 'Welcome to Baci — let’s set up your store'
      : stage === 'day7'
        ? 'Need help finishing your Baci setup?'
        : `Your next Baci setup step: ${decision.action}`;
  const introduction =
    stage === 'welcome'
      ? 'Your Baci workspace has been created. Complete your setup before sharing your store with customers.'
      : stage === 'day7'
        ? 'Your store setup is still incomplete. Reply to this email and tell us where you need help.'
        : 'Here is the next step for your store setup. You can continue from where you left off.';
  const href = new URL(decision.href, appUrl).toString();
  return {
    subject,
    textContent: `Hi ${businessName},\n\n${introduction}\n\n${decision.action}: ${href}\n\nReply if you need setup help.\nStop setup reminders: ${optOutUrl}`,
    htmlContent: `<html><body><h1>${sanitizeHtmlText(subject)}</h1><p>Hi ${sanitizeHtmlText(businessName)},</p><p>${sanitizeHtmlText(introduction)}</p><p><a href="${sanitizeHtmlText(href)}">${sanitizeHtmlText(decision.action)}</a></p><p>Reply if you need setup help.</p><p><a href="${sanitizeHtmlText(optOutUrl)}">Stop setup reminders</a></p></body></html>`,
  };
}
