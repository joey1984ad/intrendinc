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
          const cookieToken = request?.cookies?.session_token;
          const authHeader = request?.headers?.authorization;
          console.log('[JWT Strategy] Extracting token:', {
            hasCookie: !!cookieToken,
            hasAuthHeader: !!authHeader,
            cookieTokenLength: cookieToken?.length,
          });
          return cookieToken;
        },
      ]),
      ignoreExpiration: false, // Still validate expiration
      secretOrKey:
        configService.get<string>('auth.jwtSecret') ||
        'your-secret-key-change-in-production',
      passReqToCallback: false,
    });
  }

  async validate(payload: any) {
    // Check if token is expired (JWT library already validates this)
    // We can add custom validation here if needed
    console.log('[JWT Strategy] Validating payload:', {
      userId: payload.userId || payload.id,
      email: payload.email,
      exp: payload.exp,
      now: Math.floor(Date.now() / 1000),
      expired: payload.exp < Math.floor(Date.now() / 1000),
    });
    return {
      userId: payload.userId || payload.id,
      id: payload.userId || payload.id,
      email: payload.email,
      name: payload.name,
      provider: payload.provider,
      iat: payload.iat,
      exp: payload.exp,
    };
  }
}
