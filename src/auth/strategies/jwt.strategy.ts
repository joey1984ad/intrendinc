import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Try Authorization header first (for API clients, mobile apps)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Fallback to cookie (for browser sessions)
        (request: any) => {
          return request?.cookies?.session_token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('auth.jwtSecret') || 'your-secret-key-change-in-production',
    });
  }

  async validate(payload: any) {
    return { 
      id: payload.userId, 
      email: payload.email,
      name: payload.name,
      provider: payload.provider,
    };
  }
}
