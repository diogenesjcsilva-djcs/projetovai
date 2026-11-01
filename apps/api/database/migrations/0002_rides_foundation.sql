-- Sprint 3 — ride request, lifecycle, and driver location foundation.
-- Apply after 0001_initial_schema.sql. No production data is modified by this migration.
BEGIN;

CREATE TYPE ride_status AS ENUM (
  'requested',
  'searching',
  'accepted',
  'driver_arriving',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TABLE driver_locations (
  driver_user_id uuid PRIMARY KEY REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  location geography(Point, 4326) NOT NULL,
  heading_degrees smallint CHECK (heading_degrees BETWEEN 0 AND 359),
  is_available boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_locations_geography_gix ON driver_locations USING GIST (location);
CREATE INDEX driver_locations_available_idx
  ON driver_locations (is_available, updated_at DESC)
  WHERE is_available = true;

CREATE TABLE rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  passenger_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_user_id uuid REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  status ride_status NOT NULL DEFAULT 'requested',
  pickup_location geography(Point, 4326) NOT NULL,
  pickup_address varchar(300) NOT NULL,
  destination_location geography(Point, 4326) NOT NULL,
  destination_address varchar(300) NOT NULL,
  estimated_distance_meters integer CHECK (estimated_distance_meters > 0),
  estimated_duration_seconds integer CHECK (estimated_duration_seconds > 0),
  estimated_fare_cents integer CHECK (estimated_fare_cents >= 0),
  final_fare_cents integer CHECK (final_fare_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  idempotency_key varchar(128) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rides_passenger_idempotency_unique UNIQUE (passenger_user_id, idempotency_key),
  CONSTRAINT rides_distinct_coordinates CHECK (
    ST_X(pickup_location::geometry) <> ST_X(destination_location::geometry)
    OR ST_Y(pickup_location::geometry) <> ST_Y(destination_location::geometry)
  )
);
CREATE INDEX rides_passenger_created_idx ON rides (passenger_user_id, created_at DESC);
CREATE INDEX rides_driver_status_idx ON rides (driver_user_id, status) WHERE driver_user_id IS NOT NULL;
CREATE INDEX rides_city_status_created_idx ON rides (city_id, status, created_at);
CREATE INDEX rides_pickup_geography_gix ON rides USING GIST (pickup_location);

CREATE TABLE ride_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  previous_status ride_status,
  new_status ride_status NOT NULL,
  event_type varchar(40) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_ride_created_idx ON ride_events (ride_id, created_at);

COMMIT;
