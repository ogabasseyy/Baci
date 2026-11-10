export interface PublicExperienceState {
  active: boolean;
  policyRevision: string;
  catalogRevision: string;
}
export function createPublicationAdmission(deps: {
  policyRevision: string;
  catalogRevision: string;
  read: () => Promise<PublicExperienceState>;
  withdraw: () => void;
}) {
  let active = true;
  let checking: Promise<boolean> | null = null;
  const withdraw = () => {
    if (!active) return;
    active = false;
    deps.withdraw();
  };
  return {
    active: () => active,
    withdraw,
    check: () => {
      if (!active) return Promise.resolve(false);
      if (checking) return checking;
      const request = Promise.resolve()
        .then(async () => {
          try {
            const current = await deps.read();
            if (!active) return false;
            if (
              !current.active ||
              current.policyRevision !== deps.policyRevision ||
              current.catalogRevision !== deps.catalogRevision
            ) {
              withdraw();
              return false;
            }
            return true;
          } catch {
            withdraw();
            return false;
          }
        })
        .finally(() => {
          if (checking === request) checking = null;
        });
      checking = request;
      return request;
    },
  };
}
