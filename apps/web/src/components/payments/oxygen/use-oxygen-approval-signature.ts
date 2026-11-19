'use client';
import { useEffect, useRef, useState } from 'react';
import type { OxygenSignatureHandle } from './OxygenSignature';

/** Acceptance saves ink locally. It never sends a code or approves a plan. */
export function useOxygenApprovalSignature() {
  const [signature, setSignature] = useState<File>();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const capture = useRef<OxygenSignatureHandle>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function change(file: File | undefined) {
    setSignature(file);
    setAccepted(false);
    setError('');
  }
  async function accept(value: boolean) {
    if (!value) {
      setAccepted(false);
      return;
    }
    if (lock.current) return;
    if (signature) {
      setAccepted(true);
      return;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const file = await capture.current?.save();
      if (!mounted.current) return;
      if (!file) {
        setError('Add your signature before accepting this plan.');
        return;
      }
      setSignature(file);
      setAccepted(true);
    } catch {
      if (mounted.current)
        setError('We could not save your signature. Please try again.');
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return { signature, accepted, saving, error, capture, change, accept };
}
