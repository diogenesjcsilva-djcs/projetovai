import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ZENVIA_SMS_ENDPOINT = 'https://api.zenvia.com/v1/channels/sms/messages';

@Injectable()
export class SmsGateway {
  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const provider = this.config.get<string>('SMS_PROVIDER')?.toLowerCase();
    const apiToken = this.config.get<string>('SMS_API_KEY');
    const senderId = this.config.get<string>('SMS_SENDER_ID');

    if (provider !== 'zenvia' || !apiToken || !senderId) {
      throw new ServiceUnavailableException('Serviço de SMS não configurado');
    }

    try {
      const response = await fetch(ZENVIA_SMS_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'X-API-TOKEN': apiToken,
        },
        body: JSON.stringify({
          from: senderId,
          to: phone,
          contents: [
            {
              type: 'text',
              text: `Seu código de acesso ao ProjetoVai é ${code}. Ele expira em 5 minutos. Não compartilhe este código.`,
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        // Do not log provider response bodies, recipient numbers, or OTPs.
        throw new Error('SMS provider rejected request');
      }
    } catch {
      throw new ServiceUnavailableException('Não foi possível enviar o código agora');
    }
  }
}
