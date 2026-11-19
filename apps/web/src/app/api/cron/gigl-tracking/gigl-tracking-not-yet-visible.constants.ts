// GIG's batch tracking returns nothing for a booked waybill until the rider
// scans it at pickup. That is "not visible yet", not a failure: the database
// recognises this exact marker on record_gigl_tracking_failure as a quiet
// poll (no failure count, no error alert), and its back-off ladder then lets
// the monitor go dormant until a GIG webhook or the safety check wakes it.
// Reusing the existing lease-bound RPC keeps the worker's capability set
// unchanged. Keep this text in sync with the migration
// 20261118092500_gigl_tracking_trigger_driven_polling.sql.
export const GIGL_WAYBILL_NOT_YET_VISIBLE = 'GIGL waybill not yet visible';
