import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SMSGO_BASE_URL = 'https://api.smsgo.com.br/v1';
const REQUEST_TIMEOUT_MS = 5000;
const TOKEN_CACHE_TTL_MS = 47 * 60 * 60 * 1000;

@Injectable()
export class SmsGateway {
  private readonly logger = new Logger(SmsGateway.name);
  private cachedToken?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const provider = this.config.get<string>('SMS_PROVIDER')?.toLowerCase();
    const apiKey = this.config.get<string>('SMSGO_API_KEY');
    if (provider !== 'smsgo' || !apiKey) {
      this.logger.warn('sms_delivery_failed reason=configuration');
      throw new ServiceUnavailableException('Serviço de SMS não configurado');
    }

    try {
      let token = await this.getToken(apiKey);
      let response = await this.sendWithToken(phone, code, token);
      if (response.status === 401) {
        this.logger.warn('sms_provider_auth_retry status=401');
        this.cachedToken = undefined;
        token = await this.getToken(apiKey);
        response = await this.sendWithToken(phone, code, token);
      }
      if (!response.ok) {
        this.logger.warn(`sms_provider_send_rejected status=${response.status}`);
        throw new Error('SMSGo rejected send request');
      }
      this.logger.log(`sms_provider_send_accepted status=${response.status}`);
    } catch (error: unknown) {
      // Log only a fixed category. Never log exception messages, headers, bodies,
      // API keys, bearer tokens, recipient numbers, or OTP values.
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : 'request_or_response_error';
      this.logger.error(`sms_delivery_failed reason=${reason}`);
      throw new ServiceUnavailableException('Não foi possível enviar o código agora');
    }
  }

  private async sendWithToken(phone: string, code: string, token: string): Promise<Response> {
    return fetch(`${SMSGO_BASE_URL}/sms/send/single`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        phone,
        message: `ProjetoVai: seu codigo de acesso e ${code}. Expira em 5 minutos. Nao compartilhe.`,
        sms_type_id: 2,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async getToken(apiKey: string): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }

    const response = await fetch(`${SMSGO_BASE_URL}/auth/token`, {
      method: 'GET',
      headers: { 'SMSGo-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      this.logger.warn(`sms_provider_token_rejected status=${response.status}`);
      throw new Error('SMSGo token request rejected');
    }

    const data = (await response.json()) as { token?: unknown };
    if (typeof data.token !== 'string' || data.token.length === 0) {
      this.logger.warn('sms_provider_token_response_invalid');
      throw new Error('SMSGo token response invalid');
    }

    this.cachedToken = { value: data.token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS };
    this.logger.log('sms_provider_token_acquired');
    return data.token;
  }
}
