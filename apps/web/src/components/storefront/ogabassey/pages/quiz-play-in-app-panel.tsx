import type { QuizV2Event } from '@baci/shared/schemas';
import { Download } from 'lucide-react';
import {
  OGABASSEY_STOREFRONT_APP_STORE_URL,
  OGABASSEY_STOREFRONT_PLAY_STORE_URL,
} from '@/config/platform';
import { formatQuizDateRange } from './format-quiz-date-range';
import {
  quizPanel as panel,
  quizPrimaryButton as primaryButton,
  quizSecondaryButton as secondaryButton,
} from './quiz-styles';

const STATUS_LABEL: Record<QuizV2Event['status'], string> = {
  active: 'Live now',
  cancelled: 'Cancelled',
  completed: 'Ended',
  finalizing: 'Ended',
  scheduled: 'Coming soon',
};

/**
 * Prize quizzes are played in the Ogabassey app: the app carries the stronger
 * device integrity checks a real prize needs. The website shows what is on and
 * sends shoppers to the app to play and win.
 */
export function QuizPlayInAppPanel({ events }: { events: QuizV2Event[] }) {
  return (
    <section aria-labelledby="quiz-play-in-app-title" className={`${panel} sm:p-6`}>
      <h2 id="quiz-play-in-app-title" className="text-lg font-semibold">
        Play in the Ogabassey app to win
      </h2>
      <p className="mt-2 text-sm leading-6 text-store-background-text/70">
        Prize quizzes are played in the free Ogabassey app. Download it, sign in
        with this same account, and open Super Quiz.
      </p>

      {events.length > 0 ? (
        <ul aria-label="Quizzes in the app" className="mt-5 grid gap-3 md:grid-cols-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-lg border border-store-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{event.title}</p>
                  <p className="mt-1 text-sm font-medium text-store-primary">
                    Win: {event.prizeName}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-store-primary/10 px-3 py-1 text-xs font-semibold text-store-primary">
                  {STATUS_LABEL[event.status]}
                </span>
              </div>
              <p className="mt-3 text-sm text-store-background-text/70">
                {event.questionCount} questions. {formatQuizDateRange(event)}.
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <a
          className={`inline-flex items-center justify-center gap-2 ${primaryButton}`}
          href={OGABASSEY_STOREFRONT_PLAY_STORE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Download aria-hidden="true" className="size-4" />
          Get it on Google Play
        </a>
        <a
          className={`inline-flex items-center justify-center gap-2 ${secondaryButton}`}
          href={OGABASSEY_STOREFRONT_APP_STORE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Download aria-hidden="true" className="size-4" />
          Download on the App Store
        </a>
      </div>
    </section>
  );
}
