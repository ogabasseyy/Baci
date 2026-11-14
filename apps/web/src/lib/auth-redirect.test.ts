import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getAppUrl: () => 'https://usebaci.com',
}));

import {
  buildAbsoluteAppRedirectUrl,
  buildAuthConfirmRedirectUrl,
  normalizeAuthNextTarget,
  sanitizeRelativeRedirectPath,
} from '@/lib/auth-redirect';

describe('sanitizeRelativeRedirectPath', () => {
  it('returns the default path when the redirect is missing', () => {
    expect(sanitizeRelativeRedirectPath(null)).toBe('/dashboard');
  });

  it('preserves safe relative paths', () => {
    expect(sanitizeRelativeRedirectPath('/invite/token-123?accept=1')).toBe(
      '/invite/token-123?accept=1'
    );
  });

  it('normalizes legacy update-password aliases', () => {
    expect(
      sanitizeRelativeRedirectPath('/auth/update-password?source=email')
    ).toBe('/update-password?source=email');
  });

  it('rejects absolute and scheme-based redirects', () => {
    expect(
      sanitizeRelativeRedirectPath('https://evil.example.com/dashboard')
    ).toBe('/dashboard');
    expect(sanitizeRelativeRedirectPath('//evil.example.com/dashboard')).toBe(
      '/dashboard'
    );
    expect(sanitizeRelativeRedirectPath('javascript:alert(1)')).toBe(
      '/dashboard'
    );
    expect(
      sanitizeRelativeRedirectPath('data:text/html,<script>x</script>')
    ).toBe('/dashboard');
    expect(sanitizeRelativeRedirectPath('/\\evil.example/dashboard')).toBe(
      '/dashboard'
    );
    expect(sanitizeRelativeRedirectPath('/..//evil.example')).toBe(
      '/dashboard'
    );
    expect(sanitizeRelativeRedirectPath('/.//evil.example')).toBe('/dashboard');
    expect(sanitizeRelativeRedirectPath('/admin\n//evil.example')).toBe(
      '/dashboard'
    );
    expect(sanitizeRelativeRedirectPath('   ')).toBe('/dashboard');
  });
});

describe('normalizeAuthNextTarget', () => {
  it('allows same-origin absolute URLs', () => {
    expect(
      normalizeAuthNextTarget(
        'https://usebaci.com/invite/token-123?accept=1',
        'https://usebaci.com'
      )
    ).toBe('/invite/token-123?accept=1');
  });

  it('allows Baci app deep links', () => {
    expect(normalizeAuthNextTarget('baciadmin://', 'https://usebaci.com')).toBe(
      'baciadmin://'
    );
  });

  it('rejects off-origin absolute URLs', () => {
    expect(
      normalizeAuthNextTarget(
        'https://evil.example.com/invite/token-123',
        'https://usebaci.com'
      )
    ).toBe('/dashboard');
  });

  it('keeps safe relative app paths and rejects protocol-relative targets', () => {
    expect(
      normalizeAuthNextTarget(
        '/invite/token-123?accept=1',
        'https://usebaci.com'
      )
    ).toBe('/invite/token-123?accept=1');
    expect(
      normalizeAuthNextTarget('//evil.example.com/path', 'https://usebaci.com')
    ).toBe('/dashboard');
  });
});

describe('buildAuthConfirmRedirectUrl', () => {
  it('builds a canonical auth-confirm URL with a safe next path', () => {
    expect(buildAuthConfirmRedirectUrl('/invite/token-123?accept=1')).toBe(
      'https://usebaci.com/auth/confirm?next=%2Finvite%2Ftoken-123%3Faccept%3D1'
    );
  });

  it('preserves mobile deep links', () => {
    expect(buildAuthConfirmRedirectUrl('baciadmin://')).toBe(
      'https://usebaci.com/auth/confirm?next=baciadmin%3A%2F%2F'
    );
  });

  it('falls back to the dashboard for unsafe next paths', () => {
    expect(buildAuthConfirmRedirectUrl('https://evil.example.com')).toBe(
      'https://usebaci.com/auth/confirm?next=%2Fdashboard'
    );
  });
});

describe('buildAbsoluteAppRedirectUrl', () => {
  it('builds an absolute app URL from a safe relative path', () => {
    expect(buildAbsoluteAppRedirectUrl('/invite/token-123?accept=1')).toBe(
      'https://usebaci.com/invite/token-123?accept=1'
    );
  });

  it('supports the root path and rejects unsafe absolute URLs', () => {
    expect(buildAbsoluteAppRedirectUrl('/')).toBe('https://usebaci.com/');
    expect(buildAbsoluteAppRedirectUrl('https://evil.example.com')).toBe(
      'https://usebaci.com/dashboard'
    );
  });
});
