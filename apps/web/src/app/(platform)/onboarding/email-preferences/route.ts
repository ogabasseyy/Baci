import { handleOnboardingEmailPreferences } from '@/lib/onboarding-emails/preferences-handler';
import { createClient } from '@/lib/supabase/server';

// Public, single-purpose opaque-token capability. GET is confirmation only.
// The normal client invokes an RPC that can only disable setup reminders.
export function GET(request: Request): Promise<Response> {
  return handleOnboardingEmailPreferences(request, async (token) => {
    const client = await createClient();
    const { error } = await client.rpc(
      'unsubscribe_merchant_onboarding_emails',
      {
        p_token: token,
      }
    );
    if (error) throw new Error('Preference update failed');
  });
}
export const POST = GET;
