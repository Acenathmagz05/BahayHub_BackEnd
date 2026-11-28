import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequestUser } from '../interfaces/request-user.interface';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = RequestUser | undefined>(
    _err: unknown,
    user: TUser,
  ): TUser {
    return (user || undefined) as TUser;
  }
}
