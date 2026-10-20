import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsGateway {
  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const endpoint = this.config.get<string>('SMS_API_URL');
    const apiKey = this.config.get<string>('SMS_API_KEY');
    const senderId = this.config.get<string>('SMS_SENDER_ID');

    // Provider-neutral JSON adapter. Do not log the OTP or recipient.
    if (!endpoint || !apiKey || !senderId) {
      throw new ServiceUnavailableException('Serviço de SMS não configurado');
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ServiceUnavailableException('Configuração de SMS inválida');
    }
    if (url.protocol !== 'https:' && this.config.get<string>('NODE_ENV') !== 'development') {
      throw new ServiceUnavailableException('O provedor SMS deve usar HTTPS');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: senderId,
          to: phone,
          message: `Seu código de acesso é ${code}. Ele expira em 5 minutos.`,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error('SMS provider rejected request');
      }
    } catch {
      throw new ServiceUnavailableException('Não foi possível enviar o código agora');
    }
  }
}
