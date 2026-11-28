import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ErrorCode, RequestUser, Role } from '../../common';

export interface JwtAccessPayload {
  sub: number;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtAccessPayload): RequestUser {
    const userId = Number(payload?.sub);
    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Object.values(Role).includes(payload?.role)
    ) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid access token',
      });
    }

    return {
      id: userId,
      role: payload.role,
    };
  }
}
