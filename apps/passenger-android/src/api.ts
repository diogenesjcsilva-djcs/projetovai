import { clearSession, readSession, saveSession, type Session } from './session';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://projetovai-api-staging-g2qc.onrender.com/api/v1').replace(/\\/+$/, '');

type ApiErrorBody = { message?: string | string[]; error?: string };
export type Coordinate = { latitude: number; longitude: number };
export type Ride = {
  id: string;
  status: string;
  pickup_address: string;
  destination_address: string;
  estimated_distance_meters: number | null;
  estimated_duration_seconds: number | null;
  estimated_fare_cents: number | null;
  final_fare_cents: number | null;
};
export type RideEstimate = {
  distance: { meters: number; method: string };
  durationSeconds: number | null;
  fare: { amountCents: number; currency: string } | null;
  fareAvailable: boolean;
  reason?: string;
  message?: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({} as ApiErrorBody));
  if (!response.ok) {
    const message = (body as ApiErrorBody).message;
    throw new Error(Array.isArray(message) ? message.join(', ') : message ?? ('Erro HTTP ' + response.status));
  }
  return body as T;
}

async function rawRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(API_BASE_URL + path, { ...init, headers });
  return parseResponse<T>(response);
}

async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await readSession();
  if (!session) throw new Error('Sua sessão expirou. Entre novamente.');
  try {
    return await rawRequest<T>(path, init, session.accessToken);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Erro HTTP 401')) throw error;
    try {
      const refreshed = await rawRequest<Session>('/auth/session/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      await saveSession(refreshed);
      return await rawRequest<T>(path, init, refreshed.accessToken);
    } catch {
      await clearSession();
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
  }
}

export function requestOtp(phone: string): Promise<{ message: string; developmentCode?: string }> {
  return rawRequest('/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ phone, role: 'passenger' }),
  });
}

export async function verifyOtp(phone: string, code: string): Promise<Session> {
  const session = await rawRequest<Session>('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code, role: 'passenger' }),
  });
  await saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const session = await readSession();
  try {
    if (session) {
      await rawRequest('/auth/session/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
    }
  } finally {
    await clearSession();
  }
}

export function estimateRide(pickup: Coordinate, destination: Coordinate): Promise<RideEstimate> {
  return authenticatedRequest('/rides/estimate', {
    method: 'POST',
    body: JSON.stringify({ pickup, destination }),
  });
}

export function createRide(
  pickup: Coordinate,
  destination: Coordinate,
  pickupAddress: string,
  destinationAddress: string,
): Promise<Ride> {
  const idempotencyKey = 'passenger-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  return authenticatedRequest('/rides', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ pickup, destination, pickupAddress, destinationAddress }),
  });
}

export function getRide(id: string): Promise<Ride> {
  return authenticatedRequest('/rides/' + encodeURIComponent(id));
}