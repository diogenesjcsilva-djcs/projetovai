/**
 * Contratos públicos compartilhados entre apps e API.
 * Não coloque segredos, regras privilegiadas ou decisões de autorização neste pacote.
 */

export type UserRole = 'passenger' | 'driver' | 'admin';

export type TripStatus =
  | 'requested'
  | 'searching'
  | 'accepted'
  | 'driver_arriving'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_driver_found';

export type PaymentMethod = 'cash' | 'pix' | 'card';
