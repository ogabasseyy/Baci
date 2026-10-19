'use client';

import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { piggyvestPolicyReviewSchemas as schemas } from '@/schemas/piggyvest-policy-review';
import { PolicyReview } from './policy-review';

type View = z.infer<typeof schemas.view> | { status: 'loading' };
type Acceptance = z.infer<typeof schemas.acceptance>;
type Props = {
  sessionKey: string | null;
  goalId: string | null;
  load: (goalId: string, signal: AbortSignal) => Promise<unknown>;
  submit: (acceptance: Acceptance) => Promise<unknown>;
};

export function PolicyPanel({ sessionKey, goalId, load, submit }: Props) {
  const key =
    sessionKey && goalId ? JSON.stringify([sessionKey, goalId]) : null;
  const [state, setState] = useState<{
    key: string | null;
    load: Props['load'];
    submit: Props['submit'];
    view: View;
  }>({ key, load, submit, view: { status: 'loading' } });
  const matches =
    state.key === key && state.load === load && state.submit === submit;
  if (!matches) setState({ key, load, submit, view: { status: 'loading' } });

  useEffect(() => {
    if (!key || !goalId) return;
    const controller = new AbortController();
    let active = true;
    void Promise.resolve()
      .then(() => (active ? load(goalId, controller.signal) : undefined))
      .then((response) => {
        if (!active) return;
        const parsed = schemas.view.safeParse(response);
        const view: View =
          parsed.success &&
          (parsed.data.status !== 'draft' || parsed.data.goalId === goalId)
            ? parsed.data
            : { status: 'unavailable' };
        setState({ key, load, submit, view });
      })
      .catch(() => {
        if (active)
          setState({ key, load, submit, view: { status: 'unavailable' } });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, goalId, load, submit]);

  async function accept(input: Acceptance) {
    const original = state;
    const draft = original.view;
    if (
      !key ||
      !matches ||
      draft.status !== 'draft' ||
      draft.consent !== 'required' ||
      input.goalId !== draft.goalId ||
      input.revisionId !== draft.revisionId ||
      input.termsHash !== draft.terms.hash ||
      input.termsVersion !== draft.terms.version ||
      input.accepted !== true
    )
      throw new Error('Acceptance unavailable');
    const parsed = schemas.view.safeParse(await submit(input));
    if (
      !parsed.success ||
      parsed.data.status !== 'draft' ||
      parsed.data.consent !== 'accepted' ||
      JSON.stringify({ ...parsed.data, consent: 'required' }) !==
        JSON.stringify(draft)
    )
      throw new Error('Acceptance unavailable');
    const view = parsed.data;
    setState((current) =>
      current === original ? { ...current, view } : current
    );
  }

  return (
    <PolicyReview
      sessionKey={sessionKey}
      view={
        !key
          ? { status: 'unavailable' }
          : matches
            ? state.view
            : { status: 'loading' }
      }
      onAccept={accept}
    />
  );
}
