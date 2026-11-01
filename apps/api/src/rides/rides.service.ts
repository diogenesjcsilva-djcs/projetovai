import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Inject } from '@nestjs/common';
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

  async create(user: AuthenticatedRequest['user'], dto: CreateRideDto, idempotencyKey: string) {
    if (user.role !== 'passenger') throw new ForbiddenException('Apenas passageiros podem solicitar corridas');
    if (!idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException('Idempotency-Key inválida');
    if (dto.pickup.latitude === dto.destination.latitude && dto.pickup.longitude === dto.destination.longitude) {
      throw new BadRequestException('Origem e destino devem ser diferentes');
    }
    const account = await this.activeUser(user.sub);
    if (!account || account.role !== 'passenger' || !account.city_id) throw new ForbiddenException('Conta indisponível para solicitar corrida');

    try {
      const result = await this.db.query<RideRow>(
        `INSERT INTO rides (
          city_id, passenger_user_id, status, pickup_location, pickup_address,
          destination_location, destination_address, estimated_distance_meters,
          estimated_duration_seconds, idempotency_key
        ) VALUES (
          $1, $2, 'requested',
          ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5,
          ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8, $9, $10, $11
        )
        RETURNING id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
          destination_address, estimated_distance_meters, estimated_duration_seconds,
          estimated_fare_cents, final_fare_cents`,
        [account.city_id, account.id, ...this.point(dto.pickup), dto.pickupAddress,
          ...this.point(dto.destination), dto.destinationAddress,
          dto.estimatedDistanceMeters ?? null, dto.estimatedDurationSeconds ?? null, idempotencyKey],
      );
      await this.db.query(
        `INSERT INTO ride_events (ride_id, actor_user_id, previous_status, new_status, event_type)
         VALUES ($1, $2, NULL, 'requested', 'ride_requested')`,
        [result.rows[0].id, account.id],
      );
      return result.rows[0];
    } catch (error: any) {
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
         WHERE u.id = $1 AND u.role = 'driver' AND u.status = 'active' AND u.deleted_at IS NULL
           AND d.status = 'approved' AND l.is_available = true
           AND l.updated_at > now() - interval '5 minutes'`,
        [user.sub],
      );
      if (!eligible.rows[0]) throw new ForbiddenException('Motorista indisponível para aceitar corridas');

      const updated = await client.query<RideRow>(
        `UPDATE rides
         SET driver_user_id = $2, status = 'accepted', accepted_at = now(), updated_at = now()
         WHERE id = $1 AND status IN ('requested', 'searching') AND driver_user_id IS NULL
         RETURNING id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
           destination_address, estimated_distance_meters, estimated_duration_seconds,
           estimated_fare_cents, final_fare_cents`,
        [rideId, user.sub],
      );
      if (!updated.rows[0]) throw new ConflictException('Corrida não está disponível');
      await client.query(
        `INSERT INTO ride_events (ride_id, actor_user_id, previous_status, new_status, event_type)
         VALUES ($1, $2, 'requested', 'accepted', 'ride_accepted')`,
        [rideId, user.sub],
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
    const account = await this.activeUser(user.sub);
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
    if (!allowed[account.role].includes(dto.status)) throw new ForbiddenException('Transição não permitida');
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
    if (dto.finalFareCents !== undefined && dto.status !== 'completed') throw new BadRequestException('Tarifa final só pode ser definida na conclusão');

    const result = await client.query<RideRow>(
      `UPDATE rides SET status = $2,
         started_at = CASE WHEN $2 = 'in_progress' THEN now() ELSE started_at END,
         completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
         final_fare_cents = CASE WHEN $2 = 'completed' THEN COALESCE($3, final_fare_cents) ELSE final_fare_cents END,
         updated_at = now()
       WHERE id = $1 RETURNING id, city_id, passenger_user_id, driver_user_id, status, pickup_address,
         destination_address, estimated_distance_meters, estimated_duration_seconds,
         estimated_fare_cents, final_fare_cents`,
      [rideId, dto.status, dto.finalFareCents ?? null],
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
         is_available = EXCLUDED.is_available, updated_at = now()
       RETURNING driver_user_id, heading_degrees, is_available, updated_at`,
      [account.id, dto.longitude, dto.latitude, dto.headingDegrees ?? null, dto.isAvailable ?? false],
    );
    return result.rows[0];
  }
}
