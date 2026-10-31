import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_STOREFRONT_APP_STORE_URL,
  OGABASSEY_STOREFRONT_PLAY_STORE_URL,
} from '@/config/platform';
import { appQuizEvent } from './app-quiz-event.test-support';
import { QuizPlayInAppPanel } from './quiz-play-in-app-panel';

describe('QuizPlayInAppPanel', () => {
  it('sends shoppers to both app stores', () => {
    render(<QuizPlayInAppPanel events={[]} />);

    expect(
      screen.getByRole('heading', { name: 'Play in the Ogabassey app to win' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Get it on Google Play' })
    ).toHaveAttribute('href', OGABASSEY_STOREFRONT_PLAY_STORE_URL);
    expect(
      screen.getByRole('link', { name: 'Download on the App Store' })
    ).toHaveAttribute('href', OGABASSEY_STOREFRONT_APP_STORE_URL);
    expect(screen.queryByRole('list', { name: 'Quizzes in the app' })).toBeNull();
  });

  it('lists current quizzes with their prize and status, without a web start button', () => {
    render(
      <QuizPlayInAppPanel
        events={[
          appQuizEvent(),
          appQuizEvent({
            id: '22222222-2222-4222-8222-000000000009',
            status: 'scheduled',
            title: 'Weekend Quiz',
          }),
        ]}
      />
    );

    const list = screen.getByRole('list', { name: 'Quizzes in the app' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Redmi Warriors')).toBeInTheDocument();
    expect(within(items[0]).getByText('Win: iPhone XR')).toBeInTheDocument();
    expect(within(items[0]).getByText('Live now')).toBeInTheDocument();
    expect(within(items[1]).getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
