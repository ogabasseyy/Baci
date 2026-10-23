import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getConfiguredAppUrl } from '@/env';
import { createJourneyRepository } from '@/lib/onboarding-emails/repository';
import { processOnboardingEmailBatch } from '@/lib/onboarding-emails/worker';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/zeptomail';

export async function runMerchantOnboardingEmailsCli(): Promise<number> {
  try {
    const appUrl = getConfiguredAppUrl();
    if (!appUrl) throw new Error('Configured app origin is required');
    const counts = await processOnboardingEmailBatch(
      createJourneyRepository(createServiceClient()),
      sendEmail,
      appUrl
    );
    console.log(JSON.stringify({ worker: 'merchant-onboarding-emails', ...counts }));
    return counts.unknown > 0 || counts.failed > 0 ? 1 : 0;
  } catch {
    console.error('Merchant onboarding email worker failed; inspect job outcomes without logging recipient data');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runMerchantOnboardingEmailsCli().then((code) => { process.exitCode = code; });
}
