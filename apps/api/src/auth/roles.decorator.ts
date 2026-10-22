import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'required_roles';
export type AppRole = 'passenger' | 'driver' | 'admin';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
