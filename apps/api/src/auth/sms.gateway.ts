import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SMSGO_BASE_URL = 'https://api.smsgo.com.br/v1';
const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class SmsGateway {
  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const provider = this.config.get<string>('SMS_PROVIDER')?.toLowerCase();
    const apiKey = this.config.get<string>('SMSGO_API_KEY');

    if (provider !== 'smsgo' || !apiKey) {
      throw new ServiceUnavailableException('Serviço de SMS não configurado');
    }

    try {
      const tokenResponse = await fetch(`${SMSGO_BASE_URL}/auth/token`, {
        method: 'GET',
        headers: { 'SMSGo-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!tokenResponse.ok) {
        throw new Error('SMSGo token request rejected');
      }
      const tokenData = (await tokenResponse.json()) as { token?: unknown };
      if (typeof tokenData.token !== 'string' || tokenData.token.length === 0) {
        throw new Error('SMSGo token response invalid');
      }

      const sendResponse = await fetch(`${SMSGO_BASE_URL}/sms/send/single`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenData.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          phone,
          message: `ProjetoVai: seu codigo de acesso e ${code}. Expira em 5 minutos. Nao compartilhe.`,
          smsTypeId: 2,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!sendResponse.ok) {
        throw new Error('SMSGo rejected send request');
      }
    } catch {
      // Never log API keys, bearer tokens, recipient numbers, OTPs, or provider bodies.
      throw new ServiceUnavailableException('Não foi possível enviar o código agora');
    }
  }
}
