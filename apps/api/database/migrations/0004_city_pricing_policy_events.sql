-- Sprint 4 — immutable pricing-policy version audit trail.
-- Apply after 0003_city_pricing_policies.sql. No production migration is run by CI.

BEGIN;

CREATE TABLE city_pricing_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES city_pricing_policies(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type varchar(24) NOT NULL
    CHECK (event_type IN ('created', 'activated', 'deactivated')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX city_pricing_policy_events_city_created_idx
  ON city_pricing_policy_events (city_id, created_at DESC);
CREATE INDEX city_pricing_policy_events_policy_created_idx
  ON city_pricing_policy_events (policy_id, created_at DESC);

COMMENT ON TABLE city_pricing_policy_events IS
  'Append-only audit trail for administrative city pricing-policy lifecycle actions.';

COMMIT;
