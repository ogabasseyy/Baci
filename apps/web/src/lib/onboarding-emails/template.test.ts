import { expect, it } from 'vitest';
import { buildOnboardingEmail } from './template';

it('escapes merchant names, includes text, task link and opt-out without promising readiness', () => {
  const email = buildOnboardingEmail({
    businessName: '<img src=x onerror=alert(1)>',
    decision: {
      kind: 'send',
      action: 'Publish your first product',
      href: '/dashboard/products',
    },
    stage: 'welcome',
    appUrl: 'https://usebaci.com',
    optOutUrl: 'https://usebaci.com/onboarding-emails/preferences/token',
  });
  expect(email.htmlContent).not.toContain('<img');
  expect(email.textContent).toContain('https://usebaci.com/dashboard/products');
  expect(email.htmlContent).toContain('preferences/token');
  expect(email.subject).not.toContain('store is ready');
});

it('resolves task links against the configured application origin', () => {
  const email = buildOnboardingEmail({
    businessName: 'Example store',
    decision: {
      kind: 'send',
      action: 'Add a product',
      href: '/dashboard/products',
    },
    stage: 'day1',
    appUrl: 'https://staging.example.com',
    optOutUrl:
      'https://staging.example.com/onboarding/email-preferences?token=fixture',
  });
  expect(email.textContent).toContain(
    'https://staging.example.com/dashboard/products'
  );
  expect(email.htmlContent).toContain(
    'href="https://staging.example.com/dashboard/products"'
  );
  expect(email.htmlContent).not.toContain('https://usebaci.com');
});
