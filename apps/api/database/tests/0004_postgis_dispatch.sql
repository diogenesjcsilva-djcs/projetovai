-- Integration smoke test for the PostGIS dispatch search and progressive radius.
-- Runs only in the ephemeral CI database after migrations 0001-0004.
BEGIN;

DO $$
DECLARE
  v_city_id uuid;
  v_passenger_id uuid;
  v_driver_id uuid;
  v_driver_point geography;
  v_near_ride_id uuid;
  v_progressive_ride_id uuid;
  v_count integer;
BEGIN
  SELECT id INTO v_city_id FROM cities WHERE slug = 'paulista-pe';
  IF v_city_id IS NULL THEN
    RAISE EXCEPTION 'Pilot city seed missing';
  END IF;

  INSERT INTO users (phone_e164, role, status, city_id)
  VALUES ('+5511999900001', 'passenger', 'active', v_city_id)
  RETURNING id INTO v_passenger_id;

  INSERT INTO users (phone_e164, role, status, city_id)
  VALUES ('+5511999900002', 'driver', 'active', v_city_id)
  RETURNING id INTO v_driver_id;

  INSERT INTO driver_profiles (user_id, city_id, status)
  VALUES (v_driver_id, v_city_id, 'approved');

  v_driver_point := ST_SetSRID(ST_MakePoint(-34.9, -8.0), 4326)::geography;

  INSERT INTO city_pricing_policies (
    city_id, version, base_fare_cents, price_per_km_cents,
    price_per_minute_cents, minimum_fare_cents,
    initial_search_radius_meters, max_search_radius_meters,
    driver_location_max_age_seconds, search_wave_timeout_seconds, is_active
  ) VALUES (
    v_city_id, 1, 500, 200, 30, 500,
    1000, 3000, 300, 5, true
  );

  INSERT INTO driver_locations (driver_user_id, location, is_available, updated_at)
  VALUES (v_driver_id, v_driver_point, true, now());

  INSERT INTO rides (
    city_id, passenger_user_id, status, pickup_location, pickup_address,
    destination_location, destination_address, idempotency_key
  ) VALUES (
    v_city_id, v_passenger_id, 'searching',
    ST_Project(v_driver_point, 500, 0), 'Near pickup',
    ST_Project(v_driver_point, 1500, 1), 'Destination', 'dispatch-near'
  ) RETURNING id INTO v_near_ride_id;

  INSERT INTO rides (
    city_id, passenger_user_id, status, pickup_location, pickup_address,
    destination_location, destination_address, idempotency_key
  ) VALUES (
    v_city_id, v_passenger_id, 'searching',
    ST_Project(v_driver_point, 2500, 0), 'Progressive pickup',
    ST_Project(v_driver_point, 3500, 1), 'Destination', 'dispatch-progressive'
  ) RETURNING id INTO v_progressive_ride_id;

  -- Initial wave: 1 km, so only the 500 m ride is visible.
  WITH driver_context AS (
    SELECT u.city_id, l.location, p.initial_search_radius_meters,
      p.max_search_radius_meters, p.search_wave_timeout_seconds
    FROM users u
    JOIN driver_profiles d ON d.user_id = u.id
    JOIN driver_locations l ON l.driver_user_id = u.id
    JOIN city_pricing_policies p ON p.city_id = u.city_id
    WHERE u.id = v_driver_id AND u.role = 'driver' AND u.status = 'active'
      AND u.deleted_at IS NULL AND d.city_id = u.city_id AND d.status = 'approved'
      AND l.is_available = true
      AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
      AND p.is_active = true AND p.effective_from <= now()
      AND (p.effective_until IS NULL OR p.effective_until > now())
    ORDER BY p.version DESC LIMIT 1
  )
  SELECT count(*) INTO v_count
  FROM rides r CROSS JOIN driver_context dc
  WHERE r.city_id = dc.city_id AND r.status = 'searching' AND r.driver_user_id IS NULL
    AND ST_DWithin(
      r.pickup_location, dc.location,
      LEAST(
        dc.max_search_radius_meters::double precision,
        dc.initial_search_radius_meters::double precision
          * (1 + FLOOR(EXTRACT(EPOCH FROM (now() - r.requested_at))
            / dc.search_wave_timeout_seconds))
      )
    );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Initial dispatch wave expected 1 ride, found %', v_count;
  END IF;

  -- After two intervals, the 2.5 km ride enters the expanded 3 km radius.
  UPDATE rides SET requested_at = now() - interval '10 seconds'
  WHERE id = v_progressive_ride_id;

  WITH driver_context AS (
    SELECT u.city_id, l.location, p.initial_search_radius_meters,
      p.max_search_radius_meters, p.search_wave_timeout_seconds
    FROM users u
    JOIN driver_profiles d ON d.user_id = u.id
    JOIN driver_locations l ON l.driver_user_id = u.id
    JOIN city_pricing_policies p ON p.city_id = u.city_id
    WHERE u.id = v_driver_id AND u.role = 'driver' AND u.status = 'active'
      AND u.deleted_at IS NULL AND d.city_id = u.city_id AND d.status = 'approved'
      AND l.is_available = true
      AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
      AND p.is_active = true AND p.effective_from <= now()
      AND (p.effective_until IS NULL OR p.effective_until > now())
    ORDER BY p.version DESC LIMIT 1
  )
  SELECT count(*) INTO v_count
  FROM rides r CROSS JOIN driver_context dc
  WHERE r.city_id = dc.city_id AND r.status = 'searching' AND r.driver_user_id IS NULL
    AND ST_DWithin(
      r.pickup_location, dc.location,
      LEAST(
        dc.max_search_radius_meters::double precision,
        dc.initial_search_radius_meters::double precision
          * (1 + FLOOR(EXTRACT(EPOCH FROM (now() - r.requested_at))
            / dc.search_wave_timeout_seconds))
      )
    );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expanded dispatch wave expected 2 rides, found %', v_count;
  END IF;

  -- Stale driver locations must remove the driver from dispatch results.
  UPDATE driver_locations
  SET updated_at = now() - interval '10 minutes'
  WHERE driver_user_id = v_driver_id;

  WITH driver_context AS (
    SELECT u.city_id, l.location, p.initial_search_radius_meters,
      p.max_search_radius_meters, p.search_wave_timeout_seconds
    FROM users u
    JOIN driver_profiles d ON d.user_id = u.id
    JOIN driver_locations l ON l.driver_user_id = u.id
    JOIN city_pricing_policies p ON p.city_id = u.city_id
    WHERE u.id = v_driver_id AND u.role = 'driver' AND u.status = 'active'
      AND u.deleted_at IS NULL AND d.city_id = u.city_id AND d.status = 'approved'
      AND l.is_available = true
      AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
      AND p.is_active = true AND p.effective_from <= now()
      AND (p.effective_until IS NULL OR p.effective_until > now())
    ORDER BY p.version DESC LIMIT 1
  )
  SELECT count(*) INTO v_count
  FROM rides r CROSS JOIN driver_context dc
  WHERE r.city_id = dc.city_id AND r.status = 'searching' AND r.driver_user_id IS NULL
    AND ST_DWithin(
      r.pickup_location, dc.location,
      LEAST(
        dc.max_search_radius_meters::double precision,
        dc.initial_search_radius_meters::double precision
          * (1 + FLOOR(EXTRACT(EPOCH FROM (now() - r.requested_at))
            / dc.search_wave_timeout_seconds))
      )
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Stale driver location should return 0 rides, found %', v_count;
  END IF;
END;
$$;

ROLLBACK;
