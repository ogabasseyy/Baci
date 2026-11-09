import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  type PiggyvestCaptureDrainRuntime,
} from '@/schemas/piggyvest/webhook-capture-drain-runtime';

export const CAPTURE_TEST_PASSWORD = 'drain-password-never-logged';
export const captureTestRuntime: PiggyvestCaptureDrainRuntime = {
  database: {
    host: 'db.example.supabase.co',
    port: 5432,
    name: 'postgres',
    login: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
    password: CAPTURE_TEST_PASSWORD,
    certificateAuthority: 'placeholder-ca',
  },
};

export const safeCaptureSession = {
  database_name: 'postgres',
  login_name: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  role_name: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  login_safe: true,
  membership_count: 1,
  worker_membership: true,
  grants_usable: true,
  capture_surface_denied: true,
  unexpected_privileges: 0,
  tls: true,
};
