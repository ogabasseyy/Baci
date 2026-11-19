import { Suspense } from 'react';
import { ExperienceWorkspaceContent } from './workspace-content';
export const metadata = {
  title: 'Full-code experience | Baci',
  robots: { index: false, follow: false },
};
export default function ExperienceWorkspacePage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Loading workspace</h1>
        </main>
      }
    >
      <ExperienceWorkspaceContent {...props} />
    </Suspense>
  );
}
