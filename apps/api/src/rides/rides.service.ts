import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES } from '../infrastructure/infrastructure.module';
import { AuthenticatedRequest } from '../auth/access-token.guard';
import { CreateRideDto, DriverLocationDto, RideStatusDto } from './rides.dto';

type RideRow = {
  id: string; city_id: string; passenger_user_id: string; driver_user_id: string | null; status: string;
  pickup_address: string; destination_address: string; estimated_distance_meters: number | null;
  estimated_duration_seconds: number | null; estimated_fare_cents: number | null; final_fare_cents: number | null;
};

@Injectable()
export class RidesService {
  constructor(@Inject(POSTGRES) private readonly db: Pool) {}

  private async activeUser(userId: string) {
    const result = await this.db.query(
      `SELECT id, role, city_id FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [userId],
    );
    return result.rows[0] as { id: string; role: 'passenger'|'driver'|'admin'; city_id: string | null } | undefined;
  }

  private point(dto: { latitude: number; longitude: number }) {
    return [dto.longitude, dto.latitude];
  }

  async estimate(user: AuthenticatedRequest['user'], dto: { pickup: { latitude: number; longitude: number }; destination: { latitude: number; longitude: number } }) {
    if (user.role !== 'passenger') throw new ForbiddenException('Apenas passageiros podem estimar corridas');
    if (dto.pickup.latitude === dto.destination.latitude && dto.pickup.longitude === dto.destination.longitude) {
      throw new BadRequestException('Origem e destino devem ser diferentes');
    }
    const account = await this.activeUser(user.sub);
    if (!account || account.role !== 'passenger' || !account.city_id) {
      throw new ForbiddenException('Conta indisponível para estimar corrida');
    }

    const policyResult = await this.db.query(
      `SELECT id, version, base_fare_cents, price_per_km_cents, price_per_minute_cents,
        minimum_fare_cents, currency, effective_from, effective_until
       FROM city_pricing_policies
       WHERE city_id = $1 AND is_active = true
         AND effective_from <= now()
         AND (effective_until IS NULL OR effective_until > now())
       ORDER BY version DESC LIMIT 1`,
      [account.city_id],
    );
    const policy = policyResult.rows[0];
    if (!policy) {
      throw new ServiceUnavailableException('Política tarifária indisponível para esta cidade');
    }

    const radians = (degrees: number) => degrees * Math.PI / 180;
    const lat1 = radians(dto.pickup.latitude);
    const lat2 = radians(dto.destination.latitude);
    const deltaLat = lat2 - lat1;
    const deltaLon = radians(dto.destination.longitude - dto.pickup.longitude);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    const distanceMeters = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

    return {
      cityId: account.city_id,
      policy: { id: policy.id, version: policy.version, currency: policy.currency },
      distance: { meters: distanceMeters, method: 'haversine_straight_line' },
      durationSeconds: null,
      fare: null,
      fareAvailable: false,
      reason: 'ROUTE_DURATION_UNAVAILABLE',
      message: 'A tarifa depende da duração estimada da rota viária. Essa informação ainda não está disponível.',
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async availableRides(user: AuthenticatedRequest['user']) {
    if (user.role !== 'driver') throw new ForbiddenException('Apenas motoristas podem consultar corridas disponíveis');

    const eligible = await this.db.query(
      `SELECT u.city_id
       FROM users u
       JOIN driver_profiles d ON d.user_id = u.id
       JOIN driver_locations l ON l.driver_user_id = u.id
       JOIN city_pricing_policies p ON p.city_id = u.city_id
       WHERE u.id = $1 AND u.role = 'driver' AND u.status = 'active' AND u.deleted_at IS NULL
         AND d.city_id = u.city_id AND d.status = 'approved'
         AND l.is_available = true
         AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
         AND p.is_active = true AND p.effective_from <= now()
         AND (p.effective_until IS NULL OR p.effective_until > now())
       ORDER BY p.version DESC LIMIT 1`,
      [user.sub],
    );
    if (!eligible.rows[0]) {
      throw new ForbiddenException('Motorista sem perfil aprovado, localização recente ou política de despacho ativa');
    }

    const result = await this.db.query(
      `WITH driver_context AS (
         SELECT u.city_id, l.location,
           p.initial_search_radius_meters, p.max_search_radius_meters,
           p.search_wave_timeout_seconds
         FROM users u
         JOIN driver_profiles d ON d.user_id = u.id
         JOIN driver_locations l ON l.driver_user_id = u.id
         JOIN city_pricing_policies p ON p.city_id = u.city_id
         WHERE u.id = $1 AND u.role = 'driver' AND u.status = 'active'
           AND u.deleted_at IS NULL AND d.city_id = u.city_id AND d.status = 'approved'
           AND l.is_available = true
           AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
           AND p.is_active = true AND p.effective_from <= now()
           AND (p.effective_until IS NULL OR p.effective_until > now())
         ORDER BY p.version DESC LIMIT 1
       )
       SELECT r.id,
         ROUND(ST_Distance(r.pickup_location, dc.location))::integer AS pickup_distance_meters,
         r.requested_at,
         LEAST(
           dc.max_search_radius_meters::numeric,
           dc.initial_search_radius_meters::numeric
             * (1 + FLOOR(EXTRACT(EPOCH FROM (now() - r.requested_at))
               / dc.search_wave_timeout_seconds))
         )::integer AS current_search_radius_meters
       FROM rides r
       CROSS JOIN driver_context dc
       WHERE r.city_id = dc.city_id
         AND r.status = 'searching' AND r.driver_user_id IS NULL
         AND ST_DWithin(
           r.pickup_location, dc.location,
           LEAST(
             dc.max_search_radius_meters::double precision,
             dc.initial_search_radius_meters::double precision
               * (1 + FLOOR(EXTRACT(EPOCH FROM (now() - r.requested_at))
                 / dc.search_wave_timeout_seconds))
           )
         )
       ORDER BY ST_Distance(r.pickup_location, dc.location) ASC, r.requested_at ASC
       LIMIT 20`,
      [user.sub],
    );

    return {
      rides: result.rows,
      polling: true,
      message: 'A busca amplia o raio automaticamente a cada intervalo configurado; a localização exata de outros motoristas não é exposta.',
    };
  }

  async create(user: AuthenticatedRequest['user'], dto: CreateRideDto, idempotencyKey: string) {
    if (user.role !== 'passenger') throw new ForbiddenException('Apenas passageiros podem solicitar corridas');
    if (!idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException('Idempotency-Key inválida');
    if (dto.pickup.latitude === dto.destination.latitude && dto.pickup.longitude === dto.destination.longitude) {
      throw new BadRequestException('Origem e destino devem ser diferentes');
    }
    const account = await this.activeUser(user.sub);
    if (!account || account.role !== 'passenger' || !account.city_id) throw new ForbiddenException('Conta indisponível para solicitar corrida');

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const policy = await client.query(
        `SELECT id, version FROM city_pricing_policies
         WHERE city_id = $1 AND is_active = true
           AND effective_from <= now()
           AND (effective_until IS NULL OR effective_until > now())
         ORDER BY version DESC LIMIT 1 FOR SHARE`,
        [account.city_id],
      );
      if (!policy.rows[0]) {
        throw new ServiceUnavailableException('Política de despacho indisponível para esta cidade');
      }
      const result = await client.query<RideRow>(
        `INSERT INTO rides (
          city_id, passenger_user_id, status, pickup_location, pickup_address,
          destination_location, destination_address, idempotency_key
        ) VALUES (
          $1, $2, 'searching',
          ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5,
          ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8, $9
        )
        RETURNING id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
          destination_address, estimated_distance_meters, estimated_duration_seconds,
          estimated_fare_cents, final_fare_cents`,
        [account.city_id, account.id, ...this.point(dto.pickup), dto.pickupAddress,
          ...this.point(dto.destination), dto.destinationAddress, idempotencyKey],
      );
      const ride = result.rows[0];
      if (!ride) throw new BadRequestException('Não foi possível criar a corrida');
      await client.query(
        `INSERT INTO ride_events (ride_id, actor_user_id, previous_status, new_status, event_type)
         VALUES ($1, $2, NULL, 'requested', 'ride_requested')`,
        [ride.id, account.id],
      );
      await client.query(
        `INSERT INTO ride_events
          (ride_id, actor_user_id, previous_status, new_status, event_type, metadata)
         VALUES ($1, $2, 'requested', 'searching', 'ride_search_started',
           jsonb_build_object('pricing_policy_id', $3, 'pricing_policy_version', $4))`,
        [ride.id, account.id, policy.rows[0].id, policy.rows[0].version],
      );
      await client.query('COMMIT');
      return ride;
    } catch (error: any) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      if (error?.code === '23505') {
        const existing = await this.db.query<RideRow>(
          `SELECT id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
             destination_address, estimated_distance_meters, estimated_duration_seconds,
             estimated_fare_cents, final_fare_cents
           FROM rides WHERE passenger_user_id = $1 AND idempotency_key = $2`,
          [account.id, idempotencyKey],
        );
        if (existing.rows[0]) return existing.rows[0];
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findOne(user: AuthenticatedRequest['user'], rideId: string) {
    const account = await this.activeUser(user.sub);
    if (!account) throw new ForbiddenException('Conta indisponível');
    const result = await this.db.query<RideRow>(
      `SELECT id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
        destination_address, estimated_distance_meters, estimated_duration_seconds,
        estimated_fare_cents, final_fare_cents FROM rides WHERE id = $1`, [rideId],
    );
    const ride = result.rows[0];
    if (!ride) throw new NotFoundException('Corrida não encontrada');
    if (account.role !== 'admin' && ride.passenger_user_id !== account.id && ride.driver_user_id !== account.id) {
      throw new ForbiddenException('Sem acesso a esta corrida');
    }
    return ride;
  }

  async accept(user: AuthenticatedRequest['user'], rideId: string) {
    if (user.role !== 'driver') throw new ForbiddenException('Apenas motoristas podem aceitar corridas');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const eligible = await client.query(
        `SELECT u.id
         FROM users u
         JOIN driver_profiles d ON d.user_id = u.id
         JOIN driver_locations l ON l.driver_user_id = u.id
         JOIN city_pricing_policies p ON p.city_id = u.city_id
         WHERE u.id = $1 AND u.role = 'driver' AND u.status = 'active' AND u.deleted_at IS NULL
           AND d.city_id = u.city_id AND d.status = 'approved' AND l.is_available = true
           AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
           AND p.is_active = true AND p.effective_from <= now()
           AND (p.effective_until IS NULL OR p.effective_until > now())`,
        [user.sub],
      );
      if (!eligible.rows[0]) throw new ForbiddenException('Motorista indisponível para aceitar corridas');

      const updated = await client.query<RideRow & { previous_status: string }>(
        `WITH candidate AS (
           SELECT r.id, r.status AS previous_status
           FROM rides r
           JOIN users u ON u.id = $2
           JOIN driver_profiles d ON d.user_id = u.id
           JOIN driver_locations l ON l.driver_user_id = u.id
           JOIN city_pricing_policies p ON p.city_id = r.city_id
           WHERE r.id = $1 AND r.city_id = u.city_id
             AND u.role = 'driver' AND u.status = 'active' AND u.deleted_at IS NULL
             AND d.city_id = u.city_id AND d.status = 'approved'
             AND l.is_available = true
             AND l.updated_at > now() - make_interval(secs => p.driver_location_max_age_seconds)
             AND p.is_active = true AND p.effective_from <= now()
             AND (p.effective_until IS NULL OR p.effective_until > now())
             AND r.status = 'searching' AND r.driver_user_id IS NULL
             AND ST_DWithin(
               r.pickup_location, l.location,
               LEAST(
                 p.max_search_radius_meters::double precision,
                 p.initial_search_radius_meters::double precision
                   * (1 + FLOOR(EXTRACT(EPOCH FROM (now() - r.requested_at))
                     / p.search_wave_timeout_seconds))
               )
             )
           FOR UPDATE OF r
         ), changed AS (
           UPDATE rides r
           SET driver_user_id = $2, status = 'accepted', accepted_at = now(), updated_at = now()
           FROM candidate c
           WHERE r.id = c.id
           RETURNING r.id, r.city_id, r.passenger_user_id, r.driver_user_id, r.status,
             r.pickup_address, r.destination_address, r.estimated_distance_meters,
             r.estimated_duration_seconds, r.estimated_fare_cents, r.final_fare_cents,
             c.previous_status
         )
         SELECT * FROM changed`,
        [rideId, user.sub],
      );
      if (!updated.rows[0]) throw new ConflictException('Corrida não está disponível');
      await client.query(
        `INSERT INTO ride_events (ride_id, actor_user_id, previous_status, new_status, event_type)
         VALUES ($1, $2, $3, 'accepted', 'ride_accepted')`,
        [rideId, user.sub, updated.rows[0].previous_status],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async updateStatus(user: AuthenticatedRequest['user'], rideId: string, dto: RideStatusDto) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const accountResult = await client.query(
        `SELECT id, role, city_id FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [user.sub],
      );
      const account = accountResult.rows[0] as { id: string; role: 'passenger'|'driver'|'admin'; city_id: string | null } | undefined;
    if (!account) throw new ForbiddenException('Conta indisponível');
    const current = await client.query<RideRow>(
      `SELECT id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
        destination_address, estimated_distance_meters, estimated_duration_seconds,
        estimated_fare_cents, final_fare_cents FROM rides WHERE id = $1 FOR UPDATE`, [rideId],
    );
    const ride = current.rows[0];
    if (!ride) throw new NotFoundException('Corrida não encontrada');

    const allowed: Record<string, string[]> = {
      passenger: ['cancelled'],
      driver: ['driver_arriving', 'in_progress', 'completed', 'cancelled'],
      admin: [],
    };
    if (!(allowed[account.role] ?? []).includes(dto.status)) throw new ForbiddenException('Transição não permitida');
    if (account.role === 'passenger' && ride.passenger_user_id !== account.id) throw new ForbiddenException('Sem acesso a esta corrida');
    if (account.role === 'driver' && ride.driver_user_id !== account.id) throw new ForbiddenException('Sem acesso a esta corrida');

    const transitions: Record<string, string[]> = {
      requested: ['cancelled'],
      searching: ['cancelled'],
      accepted: ['driver_arriving', 'cancelled'],
      driver_arriving: ['in_progress', 'cancelled'],
      in_progress: ['completed'],
      completed: [],
      cancelled: [],
    };
    if (!transitions[ride.status]?.includes(dto.status)) throw new ConflictException('Transição de status inválida');
    if (dto.status === 'completed' && account.role !== 'driver') throw new ForbiddenException('Apenas o motorista conclui a corrida');

    const result = await client.query<RideRow>(
      `UPDATE rides SET status = $2,
         started_at = CASE WHEN $2 = 'in_progress' THEN now() ELSE started_at END,
         completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
         updated_at = now()
       WHERE id = $1 RETURNING id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
         destination_address, estimated_distance_meters, estimated_duration_seconds,
         estimated_fare_cents, final_fare_cents`,
      [rideId, dto.status],
    );
    await client.query(
      `INSERT INTO ride_events (ride_id, actor_user_id, previous_status, new_status, event_type)
       VALUES ($1, $2, $3, $4, 'status_changed')`,
      [rideId, account.id, ride.status, dto.status],
    );
    await client.query('COMMIT');
    return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLocation(user: AuthenticatedRequest['user'], dto: DriverLocationDto) {
    if (user.role !== 'driver') throw new ForbiddenException('Apenas motoristas podem atualizar localização');
    const account = await this.activeUser(user.sub);
    if (!account || account.role !== 'driver') throw new ForbiddenException('Conta indisponível');
    const approved = await this.db.query(`SELECT 1 FROM driver_profiles WHERE user_id = $1 AND status = 'approved'`, [account.id]);
    if (!approved.rows[0]) throw new ForbiddenException('Motorista não aprovado');

    const result = await this.db.query(
      `INSERT INTO driver_locations (driver_user_id, location, heading_degrees, is_available, updated_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, COALESCE($5, false), now())
       ON CONFLICT (driver_user_id) DO UPDATE SET
         location = EXCLUDED.location, heading_degrees = EXCLUDED.heading_degrees,
         is_available = COALESCE($5, driver_locations.is_available), updated_at = now()
       RETURNING driver_user_id, heading_degrees, is_available, updated_at`,
      [account.id, dto.longitude, dto.latitude, dto.headingDegrees ?? null, dto.isAvailable ?? null],
    );
    return result.rows[0];
  }
}
