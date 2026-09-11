import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import AppBody from '@/components/app-body';
import { getLandingMetrics } from './actions';
import { BaciLandingPage } from './baci-landing-page';

export default async function HomePage() {
  const metrics = await getLandingMetrics();

  return (
    <AppSansFont>
      <AppBody showPlatformAnalytics>
        <BaciLandingPage metrics={metrics} />
      </AppBody>
    </AppSansFont>
  );
}
