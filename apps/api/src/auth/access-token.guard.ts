import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { POSTGRES } from '../infrastructure/infrastructure.module';

export type AuthenticatedRequest = Request & {
  user: { sub: string; role: 'passenger' | 'driver' | 'admin'; sid: string };
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    @Inject(POSTGRES) private readonly db: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    const issuer = this.config.get<string>('JWT_ISSUER');
    const audience = this.config.get<string>('JWT_AUDIENCE');
    if (!secret || secret.length < 32 || !issuer || !audience) {
      throw new UnauthorizedException('Autenticação não configurada');
    }
    try {
      const payload = jwt.verify(authorization.slice(7), secret, {
        algorithms: ['HS256'],
        issuer,
        audience,
      });
      if (typeof payload === 'string' || !payload.sub || !payload.sid ||
          !['passenger', 'driver', 'admin'].includes(String(payload.role))) {
        throw new Error('Invalid claims');
      }
      const session = await this.db.query(
        `SELECT s.id
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.user_id = $2
           AND s.revoked_at IS NULL AND s.expires_at > now()
           AND u.status = 'active' AND u.deleted_at IS NULL
           AND u.role = $3`,
        [payload.sid, payload.sub, payload.role],
      );
      if (!session.rows[0]) throw new Error('Session is not active');
      request.user = {
        sub: payload.sub,
        sid: String(payload.sid),
        role: payload.role as 'passenger' | 'driver' | 'admin',
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido, expirado ou sessão revogada');
    }
  }
}
