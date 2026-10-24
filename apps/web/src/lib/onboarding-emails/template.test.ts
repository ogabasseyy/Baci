import { describe, expect, it } from 'vitest';
import type { OnboardingStage } from './policy';
import { buildOnboardingEmail } from './template';

const input = {
  businessName: 'Ada’s Studio',
  decision: {
    kind: 'send' as const,
    action: 'Add your first product',
    href: '/dashboard/products?onboarding=true',
  },
  stage: 'welcome' as OnboardingStage,
  appUrl: 'https://usebaci.com',
  optOutUrl: 'https://usebaci.com/onboarding/email-preferences?token=fixture',
};

describe('onboarding email presentation', () => {
  it.each<OnboardingStage>([
    'welcome',
    'day1',
    'day3',
    'day5',
    'day7',
  ])('provides an email-safe branded layout and matching accessible content for %s', (stage) => {
    const email = buildOnboardingEmail({ ...input, stage });
    const page = new DOMParser().parseFromString(
      email.htmlContent,
      'text/html'
    );
    expect(page.documentElement.lang).toBe('en');
    expect(page.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(page.querySelector('h1')?.textContent).toBeTruthy();
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('table[role="presentation"]')).not.toBeNull();
    const action = page.querySelector('a[data-onboarding-action]');
    expect(action?.textContent).toContain(input.decision.action);
    expect(action?.getAttribute('href')).toBe(
      'https://usebaci.com/dashboard/products?onboarding=true'
    );
    expect(action?.getAttribute('style')).toContain(
      'background-color: #2a2c6e'
    );
    expect(
      page.querySelector('a[href="mailto:support@usebaci.com"]')
    ).not.toBeNull();
    expect(
      page.querySelector(`a[href="${input.optOutUrl}"]`)?.textContent
    ).toBe('Stop setup reminders');
    expect(email.textContent).toContain(input.decision.action);
    expect(email.textContent).toContain(input.optOutUrl);
    expect(email.htmlContent.length).toBeLessThan(30_000);
    expect(page.querySelector('script, iframe, form')).toBeNull();
    const logo = page.querySelector('img');
    expect(logo?.getAttribute('src')).toBe(
      'https://usebaci.com/baci-logo-email.png'
    );
    expect(logo?.getAttribute('alt')).toBe('Baci');
    expect(logo?.getAttribute('width')).toBe('128');
    expect(logo?.getAttribute('height')).toBe('39');
    expect(page.querySelectorAll('img')).toHaveLength(1);
    expect(email.subject).not.toContain('store is ready');
  });

  it('escapes merchant names and action labels without creating markup or attributes', () => {
    const email = buildOnboardingEmail({
      ...input,
      businessName: '<img src=x onerror=alert(1)>',
      decision: { ...input.decision, action: '<script>alert(1)</script> "&' },
    });
    const page = new DOMParser().parseFromString(
      email.htmlContent,
      'text/html'
    );
    expect(page.querySelector('script, [onerror]')).toBeNull();
    expect(page.querySelectorAll('img')).toHaveLength(1);
    expect(page.querySelector('img')?.getAttribute('alt')).toBe('Baci');
    expect(page.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(
      page.querySelector('a[data-onboarding-action]')?.textContent
    ).toContain('<script>alert(1)</script> "&');
  });

  it('resolves task links against the configured application origin', () => {
    const email = buildOnboardingEmail({
      ...input,
      appUrl: 'https://staging.example.com',
      optOutUrl:
        'https://staging.example.com/onboarding/email-preferences?token=fixture',
    });
    expect(email.textContent).toContain(
      'https://staging.example.com/dashboard/products'
    );
    expect(email.htmlContent).toContain(
      'src="https://staging.example.com/baci-logo-email.png"'
    );
    expect(email.htmlContent).toContain(
      'href="https://staging.example.com/dashboard/products?onboarding=true"'
    );
  });

  it('uses distinct welcome, task and support copy without inventing completed steps', () => {
    const welcome = buildOnboardingEmail(input);
    const task = buildOnboardingEmail({ ...input, stage: 'day3' });
    const help = buildOnboardingEmail({ ...input, stage: 'day7' });
    expect(welcome.htmlContent).toContain('Your next chapter starts here.');
    expect(task.htmlContent).toContain('Pick up where you left off.');
    expect(help.htmlContent).toContain('A little help goes a long way.');
    for (const email of [welcome, task, help]) {
      expect(email.htmlContent).not.toMatch(
        /step \d of|\d% complete|ready to sell/i
      );
    }
  });
});
