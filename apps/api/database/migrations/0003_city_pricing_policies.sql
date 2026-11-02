-- Sprint 4 — configurable, versioned city pricing and dispatch policy.
-- Apply after 0002_rides_foundation.sql.
-- Policies are versioned: deactivate the old row and insert a new version;
-- do not overwrite historical pricing values.

BEGIN;

CREATE TABLE city_pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),

  -- Monetary values are stored as integer cents (BRL).
  base_fare_cents integer NOT NULL CHECK (base_fare_cents >= 0),
  price_per_km_cents integer NOT NULL CHECK (price_per_km_cents >= 0),
  price_per_minute_cents integer NOT NULL CHECK (price_per_minute_cents >= 0),
  minimum_fare_cents integer NOT NULL CHECK (minimum_fare_cents >= 0),

  -- Optional operational charges, also in cents.
  cancellation_fee_cents integer NOT NULL DEFAULT 0 CHECK (cancellation_fee_cents >= 0),
  waiting_per_minute_cents integer NOT NULL DEFAULT 0 CHECK (waiting_per_minute_cents >= 0),
  night_surcharge_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (night_surcharge_percent BETWEEN 0 AND 300),
  demand_surcharge_max_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (demand_surcharge_max_percent BETWEEN 0 AND 500),

  -- Dispatch/search tuning, independent of the commercial fare.
  initial_search_radius_meters integer NOT NULL DEFAULT 3000
    CHECK (initial_search_radius_meters BETWEEN 250 AND 50000),
  max_search_radius_meters integer NOT NULL DEFAULT 10000
    CHECK (max_search_radius_meters BETWEEN 250 AND 100000),
  driver_location_max_age_seconds integer NOT NULL DEFAULT 300
    CHECK (driver_location_max_age_seconds BETWEEN 30 AND 1800),
  search_wave_timeout_seconds integer NOT NULL DEFAULT 15
    CHECK (search_wave_timeout_seconds BETWEEN 5 AND 120),

  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  is_active boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT city_pricing_policy_version_unique UNIQUE (city_id, version),
  CONSTRAINT city_pricing_policy_effective_range CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT city_pricing_policy_radius_order CHECK (
    max_search_radius_meters >= initial_search_radius_meters
  ),
  CONSTRAINT city_pricing_policy_minimum_fare CHECK (
    minimum_fare_cents >= base_fare_cents
  )
);

-- At most one currently active policy per city. Historical versions remain queryable.
CREATE UNIQUE INDEX city_pricing_one_active_per_city_idx
  ON city_pricing_policies (city_id)
  WHERE is_active = true;

CREATE INDEX city_pricing_policy_history_idx
  ON city_pricing_policies (city_id, version DESC);

CREATE INDEX city_pricing_policy_effective_idx
  ON city_pricing_policies (city_id, effective_from DESC)
  WHERE is_active = true;

COMMENT ON TABLE city_pricing_policies IS
  'Versioned fare and driver-dispatch configuration per operating city. Monetary amounts use BRL cents.';
COMMENT ON COLUMN city_pricing_policies.price_per_km_cents IS
  'Fare component per kilometer, in BRL cents.';
COMMENT ON COLUMN city_pricing_policies.price_per_minute_cents IS
  'Fare component per minute, in BRL cents.';
COMMENT ON COLUMN city_pricing_policies.initial_search_radius_meters IS
  'Initial PostGIS driver-dispatch radius in meters.';
COMMENT ON COLUMN city_pricing_policies.driver_location_max_age_seconds IS
  'Maximum age of a driver location update eligible for dispatch.';

COMMIT;
