import crypto from 'node:crypto';
import { createJumiaMobileReturnUrl } from '@baci/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl, getJumiaClientId } from '@/env';
import { getJumiaAuthUrl, getJumiaRedirectUri } from '@/lib/jumia/helpers';
import { createAnonClient } from '@/lib/supabase/anon';
import { jumiaMobileTicketSchema } from '@/schemas/jumia/mobile-ticket';

/** Redeem a one-time mobile OAuth ticket without disclosing merchant data. */
export async function handleJumiaMobileTicket(
  _request: NextRequest,
  searchParams: URLSearchParams
): Promise<NextResponse | null> {
  const ticket = searchParams.get('ticket');
  if (
    !ticket ||
    searchParams.get('connectionType') !== 'oauth' ||
    searchParams.get('platform') !== 'mobile'
  ) {
    return null;
  }
  const parsedTicket = jumiaMobileTicketSchema.safeParse(ticket);
  if (!parsedTicket.success) {
    return NextResponse.redirect(
      createJumiaMobileReturnUrl({ error: 'invalid_ticket' })
    );
  }
  const jumiaClientId = getJumiaClientId();
  const appUrl = getConfiguredAppUrl();
  if (!jumiaClientId || !appUrl) {
    return NextResponse.redirect(
      createJumiaMobileReturnUrl({ error: 'oauth_not_configured' })
    );
  }
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const supabase = createAnonClient();
  const { data: redeemed, error } = await supabase.rpc(
    'redeem_jumia_oauth_handoff_ticket',
    {
      p_oauth_state: state,
      p_redeemed_expires_at: expiresAt,
      p_ticket_id: parsedTicket.data,
    }
  );
  if (error || redeemed !== true) {
    return NextResponse.redirect(
      createJumiaMobileReturnUrl({ error: 'ticket_invalid' })
    );
  }
  const redirectUrl = getJumiaAuthUrl({
    clientId: jumiaClientId,
    redirectUri: getJumiaRedirectUri(appUrl),
    state,
  });
  const response = NextResponse.redirect(redirectUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 10,
  };
  response.cookies.set('jumia_oauth_state', state, cookieOptions);
  response.cookies.set('jumia_oauth_platform', 'mobile', cookieOptions);
  response.cookies.set('jumia_ticket_id', parsedTicket.data, cookieOptions);
  return response;
}
