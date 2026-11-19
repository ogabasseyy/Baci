// @vitest-environment node

// The CI web suite is the only test job that covers supabase/functions, so it
// runs the colocated test-support tests from here.
import '../../../../supabase/functions/_shared/scheduled-notification-delivery.test-support.test';
