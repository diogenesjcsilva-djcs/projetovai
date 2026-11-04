import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'projetovai.access-token';
const REFRESH_TOKEN_KEY = 'projetovai.refresh-token';
const USER_KEY = 'projetovai.user';

export type PassengerUser = {
  id: string;
  role: 'passenger';
  displayName: string | null;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: PassengerUser;
};

export async function readSession(): Promise<Session | null> {
  const [accessToken, refreshToken, userValue] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);

  if (!accessToken || !refreshToken || !userValue) return null;
  try {
    const user = JSON.parse(userValue) as PassengerUser;
    if (user.role !== 'passenger') return null;
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900, user };
  } catch {
    await clearSession();
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  if (session.user.role !== 'passenger') {
    throw new Error('Esta versão aceita somente contas de passageiro.');
  }
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}