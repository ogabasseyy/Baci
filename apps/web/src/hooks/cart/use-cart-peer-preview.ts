'use client';
import { useEffect, useRef, useState } from 'react';
import {
  buildCartPeerLines,
  type CartPeerChannel,
  type CartPeerLine,
  type CartPeerMessage,
  createCartPeerSender,
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
  /** The tab that announced the edit. */
  sender: string;
  lines: CartPeerLine[];
  /** Confirmed cart version the editing tab made the edit on. */
  baseVersion: number;
  /** Version at which the editing tab finished; null while it is saving. */
  settledVersion: number | null;
}

function matchesConfirmed(
  lines: CartPeerLine[],
  confirmed: { id: string; quantity: number }[]
): boolean {
  if (lines.length !== confirmed.length) return false;
  const quantities = new Map(confirmed.map((line) => [line.id, line.quantity]));
  return lines.every((line) => quantities.get(line.id) === line.quantity);
}

/** A tab that closes mid-edit never settles: stop trusting its hint. */
const PREVIEW_TIMEOUT_MS = 10000;
/** A slow save repeats its announcement so siblings keep the preview. */
const REANNOUNCE_MS = 4000;
/** After this many repeats of one edit the sibling's preview may expire. */
const MAX_REANNOUNCEMENTS = 5;

/**
 * Announces this tab's pending edits to its sibling tabs and returns the
 * quantities a sibling is currently editing, or null. The preview ends when
 * this tab's own authorized snapshot moves past the version the edit was
 * made on or reaches the sibling's saved version, when this tab starts an
 * edit of its own, or after a timeout.
 */
export function useCartPeerPreview(
  context: CartPeerPreviewContext,
  open: OpenCartPeerChannel = openCartPeerChannel
): CartPeerLine[] | null {
  const { enabled, merchantId, sessionGeneration, state } = context;
  const [preview, setPreview] = useState<PeerPreview | null>(null);
  const latest = useRef(context);
  const channelRef = useRef<CartPeerChannel | null>(null);
  /** The last edit announced in this run of pending work, if any. */
  const lastPosted = useRef<string | null>(null);
  const lastEdit = useRef<CartPeerMessage | null>(null);
  // Stable for the life of this tab's cart hook, across carts.
  const [sender] = useState(createCartPeerSender);
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
  // Silent import work is not a shopper edit and never changes the display,
  // so it neither announces nor overrides a sibling's edit.
  const pending = state.queue.some((entry) => !entry.silent);

  useEffect(() => {
    setPreview(null);
    lastPosted.current = null;
    lastEdit.current = null;
    if (!ready || cartId === null) return;
    const channel = open({ cartId, merchantId }, (value) => {
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
          // Another tab finishing must not end a third tab's pending edit.
          if (current === null || current.sender !== message.sender)
            return current;
          if (ownVersion >= message.version) return null;
          return { ...current, settledVersion: message.version };
        });
        return;
      }
      // This tab's own unsaved edit wins; an edit made on an older cart
      // than this tab already holds is resolved by the server instead.
      // An edit made on a newer cart is kept: the editor's list is that
      // newer confirmed cart plus its edit, which is where this tab is
      // heading, and refusing it would flash the old quantity between
      // rapid edits.
      if (
        own.queue.some((entry) => !entry.silent) ||
        message.version < ownVersion
      )
        return;
      setPreview({
        baseVersion: message.version,
        lines: message.lines,
        sender: message.sender,
        settledVersion: null,
      });
    });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      channel?.close();
    };
  }, [ready, merchantId, cartId, sessionGeneration, open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cartId and merchantId changes reopen the channel above, which clears the last-posted refs this effect reads; sender is stable for the hook's life.
  useEffect(() => {
    const channel = channelRef.current;
    const confirmed = state.confirmed;
    if (!ready || !channel || cartId === null || confirmed === null) {
      lastPosted.current = null;
      lastEdit.current = null;
      return;
    }
    const version = confirmed.version;
    if (!pending) {
      // Nothing was announced for an edit that changed no quantity.
      if (lastPosted.current !== null)
        channel.post({ cartId, kind: 'settled', merchantId, sender, version });
      lastPosted.current = null;
      lastEdit.current = null;
      return;
    }
    const lines = buildCartPeerLines(state.display);
    // An assurance or price edit leaves every quantity as the server has
    // it: siblings already show that, so there is nothing to announce.
    if (lastPosted.current === null && matchesConfirmed(lines, confirmed.lines))
      return;
    // Display churn that changes no shared quantity (product details
    // loading) is not worth another message.
    const key = JSON.stringify([version, lines]);
    if (key === lastPosted.current) return;
    lastPosted.current = key;
    lastEdit.current = {
      cartId,
      kind: 'edit',
      lines,
      merchantId,
      sender,
      version,
    };
    channel.post(lastEdit.current);
  }, [ready, pending, state.confirmed, state.display]);

  useEffect(() => {
    if (!pending) return;
    setPreview(null);
    // Bounded per announced edit: a save that hangs must not hold siblings
    // on an unconfirmed hint (and a 'pending' cart) without end.
    let repeatOf: CartPeerMessage | null = null;
    let repeats = 0;
    const timer = setInterval(() => {
      const edit = lastEdit.current;
      if (edit !== repeatOf) {
        repeatOf = edit;
        repeats = 0;
      }
      if (!edit || repeats >= MAX_REANNOUNCEMENTS) return;
      repeats += 1;
      channelRef.current?.post(edit);
    }, REANNOUNCE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pending]);

  // Keyed to the announced lines: each edit or repeat brings a new list
  // and restarts the clock, while a settled message keeps the same list
  // and so never extends it.
  const previewLines = preview?.lines ?? null;
  useEffect(() => {
    if (previewLines === null) return;
    const timer = setTimeout(() => {
      setPreview(null);
    }, PREVIEW_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [previewLines]);

  if (preview === null || !ready || pending || version === null) return null;
  // This tab's snapshot has moved past the cart the edit was made on, so
  // the hint no longer describes it (it may hold lines the editor never saw).
  if (version > preview.baseVersion) return null;
  if (preview.settledVersion !== null && version >= preview.settledVersion)
    return null;
  return preview.lines;
}
