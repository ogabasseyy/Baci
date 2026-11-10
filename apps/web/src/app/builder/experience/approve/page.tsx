import { Suspense } from 'react';
import { ExperienceApprovalContent } from './approval-content';
export const metadata = {
  title: 'Review experience change | Baci',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default function ExperienceApprovalPage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Loading review</h1>
          <p>Checking the exact experience change.</p>
        </main>
      }
    >
      <ExperienceApprovalContent {...props} />
    </Suspense>
  );
}
