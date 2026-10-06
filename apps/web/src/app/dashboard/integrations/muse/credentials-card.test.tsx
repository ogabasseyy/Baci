import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CredentialsCard } from './credentials-card';
import { makeModel } from './model.test-support';

it('shows the one-time pair only while the issuing connection credentials are available', () => {
  const { rerender } = render(<CredentialsCard model={makeModel()} />);
  expect(
    screen.queryByText('Copy your connector credentials')
  ).not.toBeInTheDocument();
  rerender(
    <CredentialsCard
      model={makeModel({
        credentials: {
          token: 'test-access-value',
          refreshToken: 'test-refresh-value',
          grantId: 'grant-a',
        },
      })}
    />
  );
  expect(screen.getByText('test-access-value')).toBeVisible();
  expect(screen.getByText('test-refresh-value')).toBeVisible();
  rerender(<CredentialsCard model={makeModel()} />);
  expect(screen.queryByText('test-access-value')).not.toBeInTheDocument();
});
