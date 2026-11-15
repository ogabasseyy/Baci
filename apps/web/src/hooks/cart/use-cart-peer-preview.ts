'use client';
import { useEffect, useRef, useState } from 'react';
import {
  buildCartPeerLines,
  type CartPeerChannel,
  type CartPeerLine,
  type OpenCartPeerChannel,
  openCartPeerChannel,
  readCartPeerMessage,
} from './cart-peer-preview';
import { isTerminalCart } from './shared-cart-queue';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export type CartPeerPreviewContext = Pick<
  SharedCartRuntime,
  'enabled' | 'merchantId' | 'sessionGeneration' | 'state'
>;

interface PeerPreview {
  lines: CartPeerLine[];
  /** Version at which the editing tab finished; null while it is saving. */
  settledVersion: number | null;
}

/** A tab that closes mid-edit never settles: stop trusting its hint. */
const PREVIEW_TIMEOUT_MS = 10000;

/**
 * Announces this tab's pending edits to its sibling tabs and returns the
 * quantities a sibling is currently editing, or null. The preview ends when
 * this tab's own authorized snapshot reaches the sibling's saved version,
 * when this tab starts an edit of its own, or after a timeout.
 */
export function useCartPeerPreview(
  context: CartPeerPreviewContext,
  open: OpenCartPeerChannel = openCartPeerChannel
): CartPeerLine[] | null {
  const { enabled, merchantId, sessionGeneration, state } = context;
  const [preview, setPreview] = useState<PeerPreview | null>(null);
  const latest = useRef(context);
  const channelRef = useRef<CartPeerChannel | null>(null);
  const wasPending = useRef(false);
  // Advance only after commit so a message never reads an abandoned render.
  useEffect(() => {
    latest.current = context;
  });

  const cartId = state.cartId;
  const version = state.confirmed?.version ?? null;
  const ready =
    enabled &&
    state.generation === sessionGeneration &&
    cartId !== null &&
    state.confirmed !== null &&
    !isTerminalCart(state.confirmed) &&
    (state.importStatus === 'done' || state.importStatus === 'skipped');
  const busy = state.queue.length > 0;
  // Silent import work is not a shopper edit and never changes the display.
  const pending = state.queue.some((entry) => !entry.silent);

  useEffect(() => {
    setPreview(null);
    wasPending.current = false;
    if (!ready || cartId === null) return;
    const channel = open(merchantId, (value) => {
      const message = readCartPeerMessage(value);
      const own = latest.current.state;
      if (
        !message ||
        message.merchantId !== merchantId ||
        message.cartId !== cartId ||
        own.cartId !== cartId ||
        own.generation !== sessionGeneration
      )
        return;
      const ownVersion = own.confirmed?.version ?? 0;
      if (message.kind === 'settled') {
        setPreview((current) => {
          if (current === null || ownVersion >= message.version) return null;
          return { ...current, settledVersion: message.version };
        });
        return;
      }
      // This tab's own unsaved edit wins; an edit made on an older cart
      // than this tab already holds is resolved by the server instead.
      if (own.queue.length > 0 || message.version < ownVersion) return;
      setPreview({ lines: message.lines, settledVersion: null });
    });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      channel?.close();
    };
  }, [ready, merchantId, cartId, sessionGeneration, open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cartId and merchantId changes reopen the channel above, which resets this sender.
  useEffect(() => {
    const channel = channelRef.current;
    if (!ready || !channel || cartId === null || version === null) {
      wasPending.current = false;
      return;
    }
    if (pending) {
      channel.post({
        cartId,
        kind: 'edit',
        lines: buildCartPeerLines(state.display),
        merchantId,
        version,
      });
    } else if (wasPending.current) {
      channel.post({ cartId, kind: 'settled', merchantId, version });
    }
    wasPending.current = pending;
  }, [ready, pending, version, state.display]);

  useEffect(() => {
    if (busy) setPreview(null);
  }, [busy]);

  useEffect(() => {
    if (preview === null) return;
    const timer = setTimeout(() => {
      setPreview(null);
    }, PREVIEW_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [preview]);

  if (preview === null || !ready || busy) return null;
  if (
    preview.settledVersion !== null &&
    version !== null &&
    version >= preview.settledVersion
  )
    return null;
  return preview.lines;
}
