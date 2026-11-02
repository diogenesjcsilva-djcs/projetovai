-- Sprint 5 — enforce one active ride per passenger and driver at the database boundary.
-- Apply through the normal migration pipeline; do not run manually against production.
BEGIN;

-- A passenger may have only one ride being searched or serviced at a time.
CREATE UNIQUE INDEX rides_one_active_per_passenger_idx
  ON rides (passenger_user_id)
  WHERE status IN ('requested', 'searching', 'accepted', 'driver_arriving', 'in_progress');

-- A driver may never be assigned to two active rides, even under concurrent requests.
CREATE UNIQUE INDEX rides_one_active_per_driver_idx
  ON rides (driver_user_id)
  WHERE driver_user_id IS NOT NULL
    AND status IN ('accepted', 'driver_arriving', 'in_progress');

COMMENT ON INDEX rides_one_active_per_passenger_idx IS
  'Prevents duplicate concurrent ride requests for a passenger; terminal rides remain historical.';
COMMENT ON INDEX rides_one_active_per_driver_idx IS
  'Database-level invariant: a driver can have at most one accepted or in-progress ride.';

COMMIT;
