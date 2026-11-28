import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ErrorCode, Role as RoleName, UserStatus } from '../common';
import { Role } from '../roles/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { AuthResponseDto, AuthUserDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshToken } from './entities/refresh-token.entity';

const BCRYPT_COST = 12;
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface RefreshTokenPayload {
  sub: number;
  jti: string;
}

export interface AuthSessionResult extends AuthResponseDto {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto): Promise<AuthSessionResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.userRepository.findOne({
      where: { email },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'Email is already registered',
      });
    }

    const clientRole = await this.roleRepository.findOne({
      where: { name: RoleName.CLIENT },
    });
    if (!clientRole) {
      throw new InternalServerErrorException('Client role is not seeded');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    const savedUser = await this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        roleId: clientRole.id,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        passwordHash,
        phone: dto.phone ?? null,
        status: UserStatus.ACTIVE,
      });

      return manager.save(User, user);
    });

    const { accessToken, refreshToken } = await this.issueSessionTokens(
      savedUser.id,
      clientRole.name,
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUserDto(savedUser, clientRole.name),
    };
  }

  async login(dto: LoginDto): Promise<AuthSessionResult> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .innerJoinAndSelect('user.role', 'role')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    if (
      !user ||
      user.deletedAt !== null ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      });
    }

    const { accessToken, refreshToken } = await this.issueSessionTokens(
      user.id,
      user.role.name,
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUserDto(user, user.role.name),
    };
  }

  async refresh(
    rawRefreshToken: string | undefined,
  ): Promise<AuthSessionResult> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'Refresh token is missing or revoked',
      });
    }

    const payload = await this.verifyRefreshToken(rawRefreshToken);

    const txResult = await this.dataSource.transaction<
      | { status: 'missing' }
      | { status: 'reused'; userId: number }
      | { status: 'expired'; userId: number }
      | { status: 'user_unavailable'; userId: number }
      | {
          status: 'rotated';
          user: User;
          roleName: RoleName;
          newJti: string;
        }
    >(async (manager) => {
      const tokenRow = await manager
        .createQueryBuilder(RefreshToken, 'rt')
        .setLock('pessimistic_write')
        .where('rt.jti = :jti', { jti: payload.jti })
        .getOne();

      if (!tokenRow) {
        return { status: 'missing' };
      }

      const now = new Date();

      if (tokenRow.revokedAt !== null) {
        await manager.update(
          RefreshToken,
          { userId: tokenRow.userId, revokedAt: IsNull() },
          { revokedAt: now },
        );
        return { status: 'reused', userId: tokenRow.userId };
      }

      if (tokenRow.expiresAt <= now) {
        await manager.update(
          RefreshToken,
          { id: tokenRow.id, revokedAt: IsNull() },
          { revokedAt: now },
        );
        return { status: 'expired', userId: tokenRow.userId };
      }

      const user = await manager
        .createQueryBuilder(User, 'user')
        .withDeleted()
        .innerJoinAndSelect('user.role', 'role')
        .where('user.id = :id', { id: tokenRow.userId })
        .getOne();

      if (
        !user ||
        user.deletedAt !== null ||
        user.status !== UserStatus.ACTIVE
      ) {
        await manager.update(
          RefreshToken,
          { userId: tokenRow.userId, revokedAt: IsNull() },
          { revokedAt: now },
        );
        return { status: 'user_unavailable', userId: tokenRow.userId };
      }

      const newJti = randomUUID();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

      await manager.update(
        RefreshToken,
        { id: tokenRow.id },
        { revokedAt: now, replacedByJti: newJti },
      );

      const newToken = manager.create(RefreshToken, {
        userId: user.id,
        jti: newJti,
        expiresAt,
      });
      await manager.save(RefreshToken, newToken);

      return {
        status: 'rotated',
        user,
        roleName: user.role.name,
        newJti,
      };
    });

    if (txResult.status !== 'rotated') {
      throw new UnauthorizedException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'Refresh token is invalid or revoked',
      });
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(txResult.user.id, txResult.roleName),
      this.signRefreshToken(txResult.user.id, txResult.newJti),
    ]);

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUserDto(txResult.user, txResult.roleName),
    };
  }

  async logout(
    userId: number,
    rawRefreshToken: string | undefined,
  ): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    try {
      const payload = await this.verifyRefreshToken(rawRefreshToken);
      if (Number(payload.sub) === userId) {
        await this.refreshTokenRepository.update(
          { jti: payload.jti, userId, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      }
    } catch {
      // Invalid or expired refresh cookie on logout still clears the client cookie.
    }
  }

  async me(userId: number): Promise<AuthUserDto> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.role', 'role')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'User account is unavailable',
      });
    }

    return this.toAuthUserDto(user, user.role.name);
  }

  private async issueSessionTokens(
    userId: number,
    role: RoleName,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId,
        jti,
        expiresAt,
      }),
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(userId, role),
      this.signRefreshToken(userId, jti),
    ]);

    return { accessToken, refreshToken };
  }

  private signAccessToken(userId: number, role: RoleName): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, role },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      },
    );
  }

  private signRefreshToken(userId: number, jti: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, jti },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      },
    );
  }

  private async verifyRefreshToken(
    rawRefreshToken: string,
  ): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        rawRefreshToken,
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        },
      );
      if (!payload?.jti || !Number.isInteger(Number(payload.sub))) {
        throw new Error('Malformed refresh token payload');
      }
      return {
        sub: Number(payload.sub),
        jti: payload.jti,
      };
    } catch {
      throw new UnauthorizedException({
        code: ErrorCode.TOKEN_REVOKED,
        message: 'Refresh token is invalid or revoked',
      });
    }
  }

  private toAuthUserDto(user: User, role: RoleName): AuthUserDto {
    return {
      id: user.id,
      roleId: user.roleId,
      role,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
