'use client';

import { useState } from 'react';
import type { Position } from '@/components/storefront/ogabassey/components/chat/chat-launcher-geometry';
import { useChatLauncherDrag } from '@/components/storefront/ogabassey/components/chat/use-chat-launcher-drag';
import { PopupSystem } from '@/components/storefront/ogabassey/components/PopupSystem';

function DeferredLauncher({
  mobileOffset,
  onActivate,
}: {
  mobileOffset: string;
  onActivate: (position?: Position) => void;
}) {
  const drag = useChatLauncherDrag(
    undefined,
    false,
    false,
    false,
    mobileOffset
  );
  return (
    <div
      ref={drag.anchorRef}
      style={drag.anchorStyle}
      className="ogabassey-chat-anchor"
      data-mobile-offset={mobileOffset}
      data-testid="deferred-launcher"
    >
      <button
        {...drag.buttonProps}
        type="button"
        aria-label="Assistant launcher"
        className="ogabassey-chat-button"
        onClick={(event) => {
          if (!drag.suppressClick(event)) onActivate(drag.position);
        }}
      >
        Chat
      </button>
    </div>
  );
}

function ChatRuntime({
  initialPosition,
  mobileOffset,
}: {
  initialPosition?: Position;
  mobileOffset: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const drag = useChatLauncherDrag(
    initialPosition,
    isOpen,
    false,
    false,
    mobileOffset
  );
  return (
    <div
      ref={drag.anchorRef}
      style={drag.anchorStyle}
      className="ogabassey-chat-anchor"
      data-mobile-offset={mobileOffset}
      data-testid="runtime-launcher"
    >
      {isOpen && (
        <section className="ogabassey-chat-window" data-testid="chat-window">
          Chat conversation
          <button type="button" onClick={() => setIsOpen(false)}>
            Close chat
          </button>
        </section>
      )}
      <button
        {...drag.buttonProps}
        type="button"
        aria-label="Assistant launcher"
        className="ogabassey-chat-button"
        onClick={(event) => {
          if (!drag.suppressClick(event)) setIsOpen((open) => !open);
        }}
      >
        Chat
      </button>
    </div>
  );
}

export function ChatLauncherFixture() {
  const [mobileOffset, setMobileOffset] = useState('screen');
  const [runtimePosition, setRuntimePosition] = useState<Position>();
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <main>
      <button type="button" onClick={() => setMobileOffset('default')}>
        Show mobile footer
      </button>
      <PopupSystem />
      {isLoaded ? (
        <ChatRuntime
          initialPosition={runtimePosition}
          mobileOffset={mobileOffset}
        />
      ) : (
        <DeferredLauncher
          mobileOffset={mobileOffset}
          onActivate={(position) => {
            setRuntimePosition(position);
            setIsLoaded(true);
          }}
        />
      )}
    </main>
  );
}
