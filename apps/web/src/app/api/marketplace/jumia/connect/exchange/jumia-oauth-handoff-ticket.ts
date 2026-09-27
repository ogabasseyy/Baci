import type { SupabaseClient } from '@supabase/supabase-js';

type TicketRpcClient = Pick<SupabaseClient, 'rpc'>;

export async function claimJumiaOAuthHandoffTicket(
  supabase: TicketRpcClient,
  args: { merchantId: string; ticketId: string }
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'exchange_jumia_oauth_handoff_ticket',
    {
      p_merchant_id: args.merchantId,
      p_ticket_id: args.ticketId,
    }
  );
  if (error) {
    throw new Error('Failed to claim Jumia OAuth handoff ticket');
  }
  return data === true;
}

export async function finalizeJumiaOAuthHandoffTicket(
  supabase: TicketRpcClient,
  args: { merchantId: string; ticketId: string }
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'finalize_jumia_oauth_handoff_ticket',
    {
      p_merchant_id: args.merchantId,
      p_ticket_id: args.ticketId,
    }
  );
  return !error && data === true;
}

export async function releaseJumiaOAuthHandoffTicket(
  supabase: TicketRpcClient,
  args: { merchantId: string; ticketId: string }
): Promise<void> {
  const { error } = await supabase.rpc('release_jumia_oauth_handoff_ticket', {
    p_merchant_id: args.merchantId,
    p_ticket_id: args.ticketId,
  });
  if (error) {
    console.error(
      '[Jumia Exchange] Failed to release handoff ticket claim:',
      error
    );
  }
}
