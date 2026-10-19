import { describe, expect, it } from 'vitest';
import {
  checkCardMount,
  checkHeroMount,
  checkLogoMount,
} from './merchant-image-pilot-preflight-mount-kinds.mjs';

const MOUNT = {
  generationId: 'gen123',
  stagedOriginal: '/__pilot/originals/m1-asset.png',
};
const ORIGIN = 'http://localhost:3000';

describe('merchant-image-pilot-preflight-mount-kinds', () => {
  it('validates pilot and control hero mounts', () => {
    const validPilotHero = {
      html: '<picture data-pilot-lab-picture="pilot"><source type="image/avif" media="(max-width: 768px)" srcSet="/__pilot/gen123/a.avif 384w"/><source media="(max-width: 768px)" srcSet="/__pilot/gen123/a.webp 384w"/><img src="/__pilot/gen123/a.webp"/></picture>',
    };
    expect(
      checkHeroMount(validPilotHero, MOUNT, { arm: 'pilot', origin: ORIGIN })
    ).toEqual([]);
    expect(
      checkHeroMount({ html: '<div></div>' }, MOUNT, {
        arm: 'pilot',
        origin: ORIGIN,
      })
    ).toEqual(['no hero picture mounted']);

    const validControlHero = {
      html: `<picture data-pilot-lab-picture="control"><img src="${MOUNT.stagedOriginal}"/></picture>`,
    };
    expect(
      checkHeroMount(validControlHero, MOUNT, {
        arm: 'control',
        origin: ORIGIN,
      })
    ).toEqual([]);
  });

  it('validates pilot and control logo mounts', () => {
    const validPilotLogo = {
      html: '<picture data-pilot-lab-header-logo="true"><source type="image/avif" srcSet="/__pilot/gen123/a.avif 96w"/><source type="image/webp" srcSet="/__pilot/gen123/a.webp 96w"/><img src="/__pilot/gen123/a.webp"/></picture>',
    };
    expect(
      checkLogoMount(validPilotLogo, MOUNT, {
        arm: 'pilot',
        origin: ORIGIN,
        surface: 'store',
      })
    ).toEqual([]);

    const validControlStoreLogo = {
      html: `<img src="${MOUNT.stagedOriginal}?w=48&q=75"/>`,
    };
    expect(
      checkLogoMount(validControlStoreLogo, MOUNT, {
        arm: 'control',
        origin: ORIGIN,
        surface: 'store',
      })
    ).toEqual([]);
  });

  it('validates pilot and control card mounts', () => {
    const validPilotCard = {
      html: '<div data-pilot-lab-selected-card="true"><picture data-pilot-lab-card-image="true"><source type="image/avif" srcSet="/__pilot/gen123/a.avif 320w"/><img src="/__pilot/gen123/a.webp"/></picture></div>',
    };
    expect(
      checkCardMount(validPilotCard, MOUNT, {
        arm: 'pilot',
        origin: ORIGIN,
        surface: 'store',
      })
    ).toEqual([]);
    expect(
      checkCardMount({ html: '<div></div>' }, MOUNT, {
        arm: 'pilot',
        origin: ORIGIN,
        surface: 'store',
      })
    ).toEqual(['selected card wrapper is absent']);
  });
});
