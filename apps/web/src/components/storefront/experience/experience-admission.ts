export interface AdmissionStamp {
  instanceId: string;
  buildDigest: string;
  epoch: number;
  shopperPartition: string;
  revision: string;
  generation: number;
  transition: boolean;
  active: boolean;
  mode: 'private-preview' | 'published';
}
/** Each waiter re-reads the entire trusted stamp. No await between comparison/effect. */
export async function admitExperienceEffect(
  stamp: AdmissionStamp,
  current: () => AdmissionStamp,
  readActive: () => Promise<boolean>,
  enqueue: () => void
): Promise<boolean> {
  if (!stamp.active || stamp.transition) return false;
  if (!(await readActive())) return false;
  const state = current();
  if (
    !state.active ||
    state.transition ||
    (Object.keys(stamp) as Array<keyof AdmissionStamp>).some(
      (k) => stamp[k] !== state[k]
    )
  )
    return false;
  enqueue();
  return true;
}
