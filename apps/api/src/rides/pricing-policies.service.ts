import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, Inject,
} from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES } from '../infrastructure/infrastructure.module';
import { AuthenticatedRequest } from '../auth/access-token.guard';
import { CreateCityPricingPolicyDto } from './pricing-policy.dto';

@Injectable()
export class PricingPoliciesService {
  constructor(@Inject(POSTGRES) private readonly db: Pool) {}

  private async requireAdmin(user: AuthenticatedRequest['user']) {
    if (user.role !== 'admin') throw new ForbiddenException('Apenas administradores podem gerenciar tarifas');
    const result = await this.db.query(
      `SELECT id, role FROM users
       WHERE id = $1 AND role = 'admin' AND status = 'active' AND deleted_at IS NULL`,
      [user.sub],
    );
    if (!result.rows[0]) throw new ForbiddenException('Conta administrativa indisponível');
    return result.rows[0] as { id: string; role: 'admin' };
  }

  async createVersion(
    user: AuthenticatedRequest['user'],
    cityId: string,
    dto: CreateCityPricingPolicyDto,
  ) {
    const admin = await this.requireAdmin(user);
    if (dto.minimumFareCents < dto.baseFareCents) {
      throw new BadRequestException('A tarifa mínima não pode ser inferior à tarifa base');
    }
    const initialRadius = dto.initialSearchRadiusMeters ?? 3000;
    const maxRadius = dto.maxSearchRadiusMeters ?? 10000;
    if (maxRadius < initialRadius) {
      throw new BadRequestException('O raio máximo deve ser maior ou igual ao raio inicial');
    }

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const city = await client.query(
        'SELECT id FROM cities WHERE id = $1 AND is_active = true FOR UPDATE',
        [cityId],
      );
      if (!city.rows[0]) throw new NotFoundException('Cidade operacional não encontrada');

      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM city_pricing_policies WHERE city_id = $1',
        [cityId],
      );
      const version = Number(versionResult.rows[0].next_version);
      const inserted = await client.query(
        `INSERT INTO city_pricing_policies (
          city_id, version, base_fare_cents, price_per_km_cents,
          price_per_minute_cents, minimum_fare_cents, cancellation_fee_cents,
          waiting_per_minute_cents, night_surcharge_percent, demand_surcharge_max_percent,
          initial_search_radius_meters, max_search_radius_meters,
          driver_location_max_age_seconds, search_wave_timeout_seconds, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false
        )
        RETURNING id, city_id, version, base_fare_cents, price_per_km_cents,
          price_per_minute_cents, minimum_fare_cents, cancellation_fee_cents,
          waiting_per_minute_cents, night_surcharge_percent, demand_surcharge_max_percent,
          initial_search_radius_meters, max_search_radius_meters,
          driver_location_max_age_seconds, search_wave_timeout_seconds,
          currency, is_active, effective_from, effective_until, created_at`,
        [
          cityId, version, dto.baseFareCents, dto.pricePerKmCents,
          dto.pricePerMinuteCents, dto.minimumFareCents,
          dto.cancellationFeeCents ?? 0, dto.waitingPerMinuteCents ?? 0,
          dto.nightSurchargePercent ?? 0, dto.demandSurchargeMaxPercent ?? 0,
          initialRadius, maxRadius, dto.driverLocationMaxAgeSeconds ?? 300,
          dto.searchWaveTimeoutSeconds ?? 15,
        ],
      );
      const policy = inserted.rows[0];
      await client.query(
        `INSERT INTO city_pricing_policy_events
          (city_id, policy_id, actor_user_id, event_type, details)
         VALUES ($1, $2, $3, 'created', jsonb_build_object('version', $4))`,
        [cityId, policy.id, admin.id, version],
      );
      await client.query('COMMIT');
      return policy;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async activateVersion(
    user: AuthenticatedRequest['user'],
    cityId: string,
    policyId: string,
  ) {
    const admin = await this.requireAdmin(user);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const city = await client.query(
        'SELECT id FROM cities WHERE id = $1 AND is_active = true FOR UPDATE',
        [cityId],
      );
      if (!city.rows[0]) throw new NotFoundException('Cidade operacional não encontrada');

      const targetResult = await client.query(
        `SELECT id, city_id, version, is_active, effective_from, effective_until
         FROM city_pricing_policies WHERE id = $1 AND city_id = $2 FOR UPDATE`,
        [policyId, cityId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new NotFoundException('Versão tarifária não encontrada para esta cidade');
      if (target.is_active) {
        await client.query('COMMIT');
        return target;
      }
      if (new Date(target.effective_from).getTime() > Date.now()
          || (target.effective_until && new Date(target.effective_until).getTime() <= Date.now())) {
        throw new ConflictException('A versão tarifária está fora da vigência');
      }

      const current = await client.query(
        `SELECT id, version FROM city_pricing_policies
         WHERE city_id = $1 AND is_active = true FOR UPDATE`,
        [cityId],
      );
      for (const previous of current.rows) {
        await client.query(
          `UPDATE city_pricing_policies
           SET is_active = false,
               effective_until = GREATEST(clock_timestamp(), effective_from + interval '1 millisecond'),
               updated_at = clock_timestamp()
           WHERE id = $1`,
          [previous.id],
        );
        await client.query(
          `INSERT INTO city_pricing_policy_events
            (city_id, policy_id, actor_user_id, event_type, details)
           VALUES ($1, $2, $3, 'deactivated', jsonb_build_object('superseded_by', $4))`,
          [cityId, previous.id, admin.id, policyId],
        );
      }

      const activated = await client.query(
        `UPDATE city_pricing_policies SET is_active = true, updated_at = now()
         WHERE id = $1
         RETURNING id, city_id, version, base_fare_cents, price_per_km_cents,
           price_per_minute_cents, minimum_fare_cents, cancellation_fee_cents,
           waiting_per_minute_cents, night_surcharge_percent, demand_surcharge_max_percent,
           initial_search_radius_meters, max_search_radius_meters,
           driver_location_max_age_seconds, search_wave_timeout_seconds,
           currency, is_active, effective_from, effective_until, created_at`,
        [policyId],
      );
      await client.query(
        `INSERT INTO city_pricing_policy_events
          (city_id, policy_id, actor_user_id, event_type, details)
         VALUES ($1, $2, $3, 'activated', jsonb_build_object('version', $4))`,
        [cityId, policyId, admin.id, target.version],
      );
      await client.query('COMMIT');
      return activated.rows[0];
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
