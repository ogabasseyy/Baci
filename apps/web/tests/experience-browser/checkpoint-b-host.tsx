import { createRoot } from 'react-dom/client';
import {
  ExperienceFrame,
  type ExperienceFrameLaunch,
} from '../../src/components/storefront/experience/ExperienceFrame';

const active = async () => {
  const r = await fetch('/active');
  return r.ok && (await r.json()).active === true;
};
const launch = (await fetch('/launch').then((r) =>
  r.json()
)) as ExperienceFrameLaunch;
createRoot(document.getElementById('root')!).render(
  <ExperienceFrame launch={launch} isActive={active} />
);
