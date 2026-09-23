import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import AppBody from '@/components/app-body';
import { BaciLandingPage, type LandingMetrics } from './baci-landing-page';

export default function LandingPageRoute({
  metrics,
}: {
  metrics: LandingMetrics;
}) {
  return (
    <AppSansFont>
      <AppBody showPlatformAnalytics>
        <BaciLandingPage metrics={metrics} />
      </AppBody>
    </AppSansFont>
  );
}
