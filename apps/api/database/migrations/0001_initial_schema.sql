-- Sprint 2 — initial schema. Apply with a migration runner before starting auth endpoints.
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('passenger', 'driver', 'admin');
CREATE TYPE account_status AS ENUM ('pending', 'active', 'suspended', 'deleted');
CREATE TYPE driver_status AS ENUM ('pending_review', 'approved', 'rejected', 'suspended');
CREATE TYPE vehicle_status AS ENUM ('pending_review', 'approved', 'rejected', 'inactive');

CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state_code char(2) NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'BR',
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT false,
  service_area geography(MultiPolygon, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, state_code, country_code)
);

-- Seed only the pilot city; its service-area polygon must be supplied before launch.
INSERT INTO cities (name, state_code, country_code, slug, is_active)
VALUES ('Paulista', 'PE', 'BR', 'paulista-pe', true)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(16) NOT NULL UNIQUE,
  display_name varchar(120),
  role user_role NOT NULL,
  status account_status NOT NULL DEFAULT 'pending',
  phone_verified_at timestamptz,
  city_id uuid REFERENCES cities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_phone_e164_format CHECK (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$')
);
CREATE INDEX users_city_role_status_idx ON users (city_id, role, status) WHERE deleted_at IS NULL;

CREATE TABLE driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  city_id uuid NOT NULL REFERENCES cities(id),
  status driver_status NOT NULL DEFAULT 'pending_review',
  license_number_encrypted text,
  license_category varchar(8),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_profiles_city_status_idx ON driver_profiles (city_id, status);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  make varchar(60) NOT NULL,
  model varchar(60) NOT NULL,
  manufacture_year smallint NOT NULL CHECK (manufacture_year BETWEEN 1980 AND 2100),
  color varchar(40) NOT NULL,
  plate_encrypted text NOT NULL,
  plate_lookup_hash char(64) NOT NULL,
  status vehicle_status NOT NULL DEFAULT 'pending_review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plate_lookup_hash)
);
CREATE INDEX vehicles_driver_status_idx ON vehicles (driver_user_id, status);

CREATE TABLE auth_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(16) NOT NULL,
  code_hash char(64) NOT NULL,
  purpose varchar(24) NOT NULL DEFAULT 'login' CHECK (purpose IN ('login')),
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_ip_hash char(64),
  CONSTRAINT otp_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX auth_otp_phone_created_idx ON auth_otp_challenges (phone_e164, created_at DESC);
CREATE INDEX auth_otp_expiry_idx ON auth_otp_challenges (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

COMMIT;
