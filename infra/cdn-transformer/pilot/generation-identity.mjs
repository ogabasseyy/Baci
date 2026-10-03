import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { RECIPE_ID } from './constants.mjs';

export function buildEncoderIdentity() {
  return {
    libvipsVersion: sharp.versions.vips,
    name: 'sharp',
    sharpVersion: sharp.versions.sharp,
  };
}

export function generationIdFor({ encoderIdentity, job, recipeId, sourceSha256 }) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        assetId: job.assetId,
        encoderIdentity,
        merchantId: job.merchantId,
        recipeId,
        role: job.role,
        sourceSha256,
      })
    )
    .digest('hex');
}

export function currentRecipeId() {
  return RECIPE_ID;
}
