import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  buildNativePreviewInitScript,
  buildNativePreviewRenderScript,
} from './native-preview-script';
import {
  bindNativePreviewSession,
  createNativePreviewSession,
  type NativePreviewInput,
  type NativePreviewSession,
  rotateNativePreviewSession,
  sessionIsCurrent,
} from './native-preview-session-context';
import { useNativePreviewLoadTimeout } from './use-native-preview-load-timeout';

type PreviewError = 'handshake' | 'render' | 'load' | 'invalid';
const TIMEOUT_MS = 10_000;
const HANDSHAKE_INTERVAL_MS = 750;
export function useNativePreviewBridge(input: NativePreviewInput) {
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);
  const webViewRef = useRef<{
    injectJavaScript: (script: string) => void;
  } | null>(null);
  const activeSession = useRef<NativePreviewSession | null>(null);
  const revision = useRef(0);
  const instanceCounter = useRef(0);
  const lifecycle = useRef(0);
  const loadedInstance = useRef<number | null>(null);
  const lastRequestKey = useRef<string | null>(null);
  const [session, setSession] = useState<NativePreviewSession | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<PreviewError | null>(null);
  const [hasRendered, setHasRendered] = useState(false);
  useNativePreviewLoadTimeout(
    session,
    loaded,
    error !== null,
    activeSession,
    inputRef,
    setError
  );
  useEffect(() => {
    let cancelled = false;
    lifecycle.current += 1;
    activeSession.current = null;
    setSession(null);
    setLoaded(false);
    setReady(false);
    setPending(null);
    setError(null);
    setHasRendered(false);
    revision.current = 0;
    loadedInstance.current = null;
    lastRequestKey.current = null;
    void createNativePreviewSession(
      input.identityKey,
      epoch,
      ++instanceCounter.current
    )
      .then((next) => {
        if (cancelled) return;
        if (!inputRef.current.isIdentityCurrent()) {
          setError('handshake');
          return;
        }
        activeSession.current = next;
        setSession(next);
      })
      .catch(() => {
        if (!cancelled) setError('handshake');
      });
    return () => {
      cancelled = true;
      lifecycle.current += 1;
      activeSession.current = null;
    };
  }, [input.identityKey, epoch]);
  useEffect(() => {
    if (
      !session ||
      !loaded ||
      ready ||
      error ||
      !sessionIsCurrent(
        activeSession.current,
        inputRef.current,
        session.instanceId,
        session.nonce
      )
    )
      return;
    const script = buildNativePreviewInitScript(
      session.nonce,
      session.previousNonce
    );
    if (!script) {
      activeSession.current = null;
      setError('handshake');
      return;
    }
    const send = () => {
      try {
        if (
          sessionIsCurrent(
            activeSession.current,
            inputRef.current,
            session.instanceId,
            session.nonce
          )
        )
          webViewRef.current?.injectJavaScript(script);
      } catch {
        activeSession.current = null;
        setError('load');
      }
    };
    send();
    const interval = setInterval(send, HANDSHAKE_INTERVAL_MS);
    const timeout = setTimeout(() => {
      if (
        sessionIsCurrent(
          activeSession.current,
          inputRef.current,
          session.instanceId,
          session.nonce
        )
      ) {
        activeSession.current = null;
        setError('handshake');
      }
    }, TIMEOUT_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [session, loaded, ready, error]);
  useEffect(() => {
    if (
      !session ||
      !ready ||
      !sessionIsCurrent(
        activeSession.current,
        inputRef.current,
        session.instanceId,
        session.nonce
      )
    )
      return;
    const requestKey = `${input.draftRevision}`;
    if (lastRequestKey.current === requestKey) return;
    const next = revision.current + 1;
    const script = buildNativePreviewRenderScript({
      candidateConfig: inputRef.current.config,
      merchant: inputRef.current.merchant,
      revision: next,
      sessionNonce: session.nonce,
    });
    if (!script || !webViewRef.current || !session.controller.begin(next)) {
      setError('invalid');
      return;
    }
    revision.current = next;
    lastRequestKey.current = requestKey;
    setError(null);
    setPending(next);
    try {
      webViewRef.current.injectJavaScript(script);
    } catch {
      session.controller.timeout(next);
      setPending(null);
      setError('render');
    }
  }, [session, ready, input.draftRevision]);
  useEffect(() => {
    if (!session || pending === null) return;
    const timeout = setTimeout(() => {
      if (
        sessionIsCurrent(
          activeSession.current,
          inputRef.current,
          session.instanceId,
          session.nonce
        ) &&
        session.controller.timeout(pending)
      ) {
        setPending(null);
        setError('render');
      }
    }, TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [session, pending]);
  const accepts = bindNativePreviewSession(activeSession, inputRef);
  return {
    nonce: session?.identityKey === input.identityKey ? session.nonce : null,
    instanceId:
      session?.identityKey === input.identityKey ? session.instanceId : 0,
    webViewRef,
    hasRendered,
    pending: pending !== null,
    error,
    onLoadStart(instanceId: number, nonce: string) {
      if (loadedInstance.current !== instanceId) return;
      const rotating =
        !activeSession.current &&
        session?.instanceId === instanceId &&
        session.nonce === nonce &&
        inputRef.current.isIdentityCurrent();
      if (!rotating && !accepts(instanceId, nonce)) return;
      lifecycle.current += 1;
      activeSession.current = null;
      setSession(null);
      setEpoch((value) => value + 1);
    },
    onLoad(instanceId: number, nonce: string) {
      if (!accepts(instanceId, nonce)) return;
      if (loadedInstance.current === instanceId) {
        activeSession.current = null;
        setSession(null);
        setEpoch((value) => value + 1);
        return;
      }
      loadedInstance.current = instanceId;
      setLoaded(true);
    },
    onLoadError(instanceId: number, nonce: string) {
      if (accepts(instanceId, nonce)) {
        activeSession.current = null;
        setLoaded(false);
        setError('load');
      }
    },
    onMessage(instanceId: number, nonce: string, raw: string) {
      if (!accepts(instanceId, nonce)) return;
      const outcome = activeSession.current?.controller.receive(raw);
      if (outcome === 'ready') {
        setReady(true);
        setError(null);
      }
      if (outcome === 'rendered') {
        setPending(null);
        setError(null);
        setHasRendered(true);
      }
      if (outcome === 'error') {
        setPending(null);
        setError('render');
      }
    },
    retry() {
      if (error === 'handshake' || error === 'load') {
        activeSession.current = null;
        setSession(null);
        setEpoch((value) => value + 1);
      } else {
        const previous = activeSession.current;
        if (!previous || !inputRef.current.isIdentityCurrent()) return;
        activeSession.current = null;
        const currentLifecycle = lifecycle.current;
        setReady(false);
        setPending(null);
        setError(null);
        void rotateNativePreviewSession(
          previous,
          () =>
            lifecycle.current === currentLifecycle &&
            activeSession.current === null &&
            inputRef.current.isIdentityCurrent() &&
            inputRef.current.identityKey === previous.identityKey
        )
          .then((next) => {
            if (
              !next ||
              lifecycle.current !== currentLifecycle ||
              activeSession.current !== null ||
              !inputRef.current.isIdentityCurrent() ||
              inputRef.current.identityKey !== previous.identityKey
            )
              return;
            activeSession.current = next;
            revision.current = 0;
            lastRequestKey.current = null;
            setSession(next);
          })
          .catch(() => {
            if (
              lifecycle.current === currentLifecycle &&
              activeSession.current === null
            )
              setError('handshake');
          });
      }
    },
  };
}
