import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// Retired: auth.users includes customers and staff. Merchant welcomes are now
// owned by the gated merchant onboarding queue. Never process legacy payloads.
Deno.serve(
  () =>
    new Response(JSON.stringify({ code: 'WELCOME_SENDER_RETIRED' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    })
);
