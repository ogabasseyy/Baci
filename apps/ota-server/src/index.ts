import { handleAdminPublish, handleAdminUploadAsset } from './admin-handler';
import { handleAdminGetRelease } from './admin-release-handler';
import { handleAdminRollback } from './admin-rollback-handler';
import { handleGetAsset } from './assets-handler';
import { handleGetManifest } from './manifest-handler';
import type { OtaWorkerEnv } from './types';
import { errorResponse, jsonResponse } from './validation';

export function handleRequest(
  request: Request,
  env: OtaWorkerEnv
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/health') {
    if (request.method !== 'GET') {
      return Promise.resolve(errorResponse('Method not allowed', 405));
    }
    return Promise.resolve(
      jsonResponse({
        ok: true,
        service: 'baci-ota-server',
        status: 'healthy',
        timestamp: new Date().toISOString(),
      })
    );
  }

  if (pathname === '/api/manifest') {
    return handleGetManifest(request, env);
  }

  if (pathname.startsWith('/api/assets/')) {
    return handleGetAsset(request, env, pathname);
  }

  if (pathname.startsWith('/api/admin/assets/')) {
    return handleAdminUploadAsset(request, env, pathname);
  }

  if (pathname === '/api/admin/publish') {
    return handleAdminPublish(request, env);
  }

  if (pathname === '/api/admin/release') {
    return handleAdminGetRelease(request, env);
  }

  if (pathname === '/api/admin/rollback') {
    return handleAdminRollback(request, env);
  }

  return Promise.resolve(errorResponse('Not found', 404));
}

export default {
  fetch(request: Request, env: OtaWorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
