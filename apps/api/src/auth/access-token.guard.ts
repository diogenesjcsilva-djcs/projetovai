import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import jwt from 'jsonwebtoken';

export type AuthenticatedRequest = Request & {
  user: { sub: string; role: 'passenger' | 'driver' | 'admin'; sid: string };
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
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
      request.user = {
        sub: payload.sub,
        sid: String(payload.sid),
        role: payload.role as 'passenger' | 'driver' | 'admin',
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}
