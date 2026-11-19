// Functions here are serialised into the browser page by Playwright, so each
// must stay self-contained (no references to Node-side variables).

export function cookieClaims() {
  const raw = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('cw_conversation='))
    ?.slice('cw_conversation='.length);
  if (!raw) return null;
  const payload = raw.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
  if (!payload) return null;
  try {
    return JSON.parse(
      atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
    );
  } catch {
    return null;
  }
}

export function instrumentReset(resetDelayMs) {
  const target = window;
  const widget = target.$chatwoot;
  if (!widget?.reset) throw new Error('SDK reset method unavailable');
  const originalReset = widget.reset.bind(widget);
  const originalOnMessage = target.onmessage;
  const matchesPreviousInbox = () => {
    const rawCookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('cw_conversation='))
      ?.slice('cw_conversation='.length);
    if (!rawCookie) return false;
    const payload = rawCookie
      .split('.')[1]
      ?.replace(/-/g, '+')
      .replace(/_/g, '/');
    if (!payload) return false;
    try {
      const claims = JSON.parse(
        atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
      );
      return (
        String(claims.inbox_id) ===
        sessionStorage.getItem('__chatwootPreviousInbox')
      );
    } catch {
      return false;
    }
  };
  target.onmessage = (event) => {
    let cookieWriteEvent = null;
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data.replace(/^chatwoot-widget:/, ''));
        if (message.event === 'loaded' || message.event === 'setAuthCookie') {
          cookieWriteEvent = message.event;
        }
      } catch {
        cookieWriteEvent = null;
      }
    }
    const trackCookieWriteEvent =
      cookieWriteEvent !== null &&
      sessionStorage.getItem('__chatwootFixtureResetRequested') === 'true';
    const beforeMatchesTenantA = trackCookieWriteEvent
      ? matchesPreviousInbox()
      : false;
    const result = originalOnMessage?.call(target, event);
    if (trackCookieWriteEvent) {
      const rawEvents = sessionStorage.getItem(
        '__chatwootFixturePostResetLoadedEvents'
      );
      let events = [];
      try {
        events = JSON.parse(rawEvents ?? '[]');
      } catch {
        events = [];
      }
      events.push({
        event: cookieWriteEvent,
        resetTriggered: target.$chatwoot?.resetTriggered === true,
        sourceMatchesWidgetFrame:
          event.source ===
          document.getElementById('chatwoot_live_chat_widget')?.contentWindow,
        beforeMatchesTenantA,
        afterMatchesTenantA: matchesPreviousInbox(),
      });
      sessionStorage.setItem(
        '__chatwootFixturePostResetLoadedEvents',
        JSON.stringify(events.slice(-8))
      );
    }
    return result;
  };
  widget.reset = () => {
    sessionStorage.setItem('__chatwootFixtureResetRequested', 'true');
    const beforeMatchesTenantA = matchesPreviousInbox();
    const result = originalReset();
    // Only the first reset is evidence: a later reset legitimately runs after
    // the first already cleared the cookie and before the iframe rewrote it.
    if (!sessionStorage.getItem('__chatwootFixtureResetEvidence')) {
      target.__chatwootFixtureResetEvidence = {
        beforeMatchesTenantA,
        afterMatchesTenantA: matchesPreviousInbox(),
      };
      sessionStorage.setItem(
        '__chatwootFixtureResetEvidence',
        JSON.stringify(target.__chatwootFixtureResetEvidence)
      );
    }
    if (resetDelayMs > 0) {
      const samples = [];
      const sampleCookie = () => {
        const matched = matchesPreviousInbox();
        if (samples.length === 0 || samples.at(-1) !== matched) {
          samples.push(matched);
          sessionStorage.setItem(
            '__chatwootFixtureResetCookieTransitions',
            JSON.stringify(samples)
          );
        }
      };
      sampleCookie();
      const interval = window.setInterval(sampleCookie, 10);
      window.setTimeout(
        () => window.clearInterval(interval),
        resetDelayMs - 50
      );
    }
    return result;
  };
}

export function collectTenantBResult() {
  const target = window;
  const rawCookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('cw_conversation='))
    ?.slice('cw_conversation='.length);
  let current;
  if (rawCookie) {
    const payload = rawCookie
      .split('.')[1]
      ?.replace(/-/g, '+')
      .replace(/_/g, '/');
    if (payload) {
      try {
        current = JSON.parse(
          atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
        );
      } catch {
        current = undefined;
      }
    }
  }
  return {
    documentStart: target.__chatwootFixtureDocumentStart,
    previousInbox: sessionStorage.getItem('__chatwootPreviousInbox'),
    currentInbox: current?.inbox_id ?? null,
    bridgeTenant: document.querySelector('[data-testid="bridge-tenant"]')
      ?.textContent,
    resetEvidence: (() => {
      try {
        return JSON.parse(
          sessionStorage.getItem('__chatwootFixtureResetEvidence') ?? 'null'
        );
      } catch {
        return null;
      }
    })(),
    postResetLoadedEvents: (() => {
      try {
        return JSON.parse(
          sessionStorage.getItem('__chatwootFixturePostResetLoadedEvents') ??
            '[]'
        );
      } catch {
        return [];
      }
    })(),
    resetCookieTransitions: (() => {
      try {
        return JSON.parse(
          sessionStorage.getItem('__chatwootFixtureResetCookieTransitions') ??
            '[]'
        );
      } catch {
        return [];
      }
    })(),
  };
}

export async function probeUntrustedFrame({ marker, widgetMessage }) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.display = 'none';
  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage, true);
      frame.remove();
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;
      window.setTimeout(() => {
        const cookie = document.cookie
          .split('; ')
          .find((entry) => entry.startsWith('cw_conversation='));
        finish({
          received: true,
          opaqueOrigin: event.origin === 'null',
          sourceIsWidgetFrame:
            event.source ===
            document.getElementById('chatwoot_live_chat_widget')?.contentWindow,
          cookieWriteAccepted: cookie === `cw_conversation=${marker}`,
        });
      }, 0);
    };
    window.addEventListener('message', onMessage, true);
    const script = `parent.postMessage(${JSON.stringify(widgetMessage)}, "*")`;
    frame.srcdoc = ['<script>', script, '</script>'].join('');
    document.body.append(frame);
    window.setTimeout(() => finish({ received: false }), 2_000);
  });
  return result;
}
