import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DataSource, IsNull, LessThan, QueryFailedError } from 'typeorm';
import { ErrorCode, Role as RoleName, UserStatus } from '../common';
import { Role } from '../roles/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';

describe('AuthService', () => {
  let service: AuthService;

  const mockUserRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockRoleRepo = {
    findOne: jest.fn(),
  };

  const mockRefreshTokenRepo = {
    create: jest.fn((data: unknown) => data),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') {
        return 'access-secret-at-least-32-chars-long';
      }
      if (key === 'JWT_REFRESH_SECRET') {
        return 'refresh-secret-at-least-32-chars-long';
      }
      return 'value';
    }),
  };

  const mockDataSource = {
    transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Role), useValue: mockRoleRepo },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshTokenRepo,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('registers a client user and first refresh token in one transaction', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    mockRoleRepo.findOne.mockResolvedValue({
      id: 3,
      name: RoleName.CLIENT,
      description: 'Client',
    });

    const now = new Date();
    const savedEntities: unknown[] = [];
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<User>) => {
        const manager = {
          create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
            ...data,
            id: 10,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })),
          save: jest.fn((entity: unknown, row: unknown) => {
            savedEntities.push({ entity, row });
            return Promise.resolve(row);
          }),
        };
        return cb(manager);
      },
    );

    mockJwtService.signAsync
      .mockResolvedValueOnce('access.jwt.token')
      .mockResolvedValueOnce('refresh.jwt.token');

    const result = await service.register({
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      email: '  JUAN@Example.COM ',
      password: 'Password123',
      phone: '09171234567',
    });

    expect(result.accessToken).toBe('access.jwt.token');
    expect(result.refreshToken).toBe('refresh.jwt.token');
    expect(result.user.email).toBe('juan@example.com');
    expect(result.user.role).toBe(RoleName.CLIENT);
    expect(result.user.id).toBe(10);
    expect('passwordHash' in result.user).toBe(false);
    expect(savedEntities).toHaveLength(2);
    expect(savedEntities[0]).toMatchObject({ entity: User });
    expect(savedEntities[1]).toMatchObject({ entity: RefreshToken });
    expect(mockRefreshTokenRepo.save).not.toHaveBeenCalled();
    expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      { sub: 10, role: RoleName.CLIENT },
      expect.objectContaining({ algorithm: 'HS256' }),
    );
    expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      { sub: 10, jti: expect.any(String) },
      expect.objectContaining({ algorithm: 'HS256' }),
    );
  });

  it('throws CONFLICT when registering an existing email', async () => {
    mockUserRepo.findOne.mockResolvedValue({ id: 1, email: 'juan@example.com' });

    await expect(
      service.register({
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        email: 'juan@example.com',
        password: 'Password123',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('maps Postgres 23505 unique violation during register transaction to CONFLICT', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    mockRoleRepo.findOne.mockResolvedValue({
      id: 3,
      name: RoleName.CLIENT,
      description: 'Client',
    });

    const uniqueError = new QueryFailedError(
      'INSERT INTO users',
      [],
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );
    mockDataSource.transaction.mockRejectedValue(uniqueError);

    await expect(
      service.register({
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        email: 'race@example.com',
        password: 'Password123',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: ErrorCode.CONFLICT,
      },
    });
  });

  it('runs bcrypt.compare against dummy hash when user is missing and returns INVALID_CREDENTIALS', async () => {
    const compareSpy = jest
      .spyOn(bcrypt, 'compare')
      .mockImplementation(() => Promise.resolve(false));
    const qb = {
      withDeleted: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    mockUserRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(
      service.login({ email: 'missing@example.com', password: 'Password123' }),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      },
    });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy.mock.calls[0]?.[1]).toMatch(/^\$2b\$12\$/);
  });

  it('runs bcrypt.compare against dummy hash for deleted user and returns INVALID_CREDENTIALS', async () => {
    const compareSpy = jest
      .spyOn(bcrypt, 'compare')
      .mockImplementation(() => Promise.resolve(true));
    const qb = {
      withDeleted: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 1,
        roleId: 3,
        role: { id: 3, name: RoleName.CLIENT },
        email: 'deleted@example.com',
        passwordHash: '$2b$12$realhashrealhashrealhashrealhashrealhashrealhashre',
        status: UserStatus.ACTIVE,
        deletedAt: new Date(),
      }),
    };
    mockUserRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(
      service.login({ email: 'deleted@example.com', password: 'Password123' }),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      },
    });

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy.mock.calls[0]?.[1]).not.toBe(
      '$2b$12$realhashrealhashrealhashrealhashrealhashrealhashre',
    );
  });

  it('rejects wrong password with INVALID_CREDENTIALS', async () => {
    const passwordHash = await bcrypt.hash('CorrectPass1', 4);
    const qb = {
      withDeleted: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 1,
        roleId: 3,
        role: { id: 3, name: RoleName.CLIENT },
        email: 'juan@example.com',
        passwordHash,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      }),
    };
    mockUserRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(
      service.login({ email: 'juan@example.com', password: 'WrongPassword1' }),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      },
    });
  });

  it('rejects suspended user on login with INVALID_CREDENTIALS', async () => {
    const passwordHash = await bcrypt.hash('Password123', 4);
    const compareSpy = jest.spyOn(bcrypt, 'compare');
    const qb = {
      withDeleted: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 1,
        roleId: 3,
        role: { id: 3, name: RoleName.CLIENT },
        email: 'juan@example.com',
        passwordHash,
        status: UserStatus.SUSPENDED,
        deletedAt: null,
      }),
    };
    mockUserRepo.createQueryBuilder.mockReturnValue(qb);

    const promise = service.login({
      email: 'juan@example.com',
      password: 'Password123',
    });

    await expect(promise).rejects.toThrow(UnauthorizedException);
    await expect(promise).rejects.toMatchObject({
      response: {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      },
    });
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy.mock.calls[0]?.[1]).toMatch(/^\$2b\$12\$/);
  });

  it('deletes expired refresh tokens and pins HS256 on successful login', async () => {
    const passwordHash = await bcrypt.hash('Password123', 4);
    const qb = {
      withDeleted: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 5,
        roleId: 3,
        role: { id: 3, name: RoleName.CLIENT },
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        email: 'juan@example.com',
        passwordHash,
        phone: null,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    };
    mockUserRepo.createQueryBuilder.mockReturnValue(qb);
    mockRefreshTokenRepo.delete.mockResolvedValue({});
    mockRefreshTokenRepo.save.mockResolvedValue({});
    mockJwtService.signAsync
      .mockResolvedValueOnce('access.jwt.token')
      .mockResolvedValueOnce('refresh.jwt.token');

    await service.login({ email: 'juan@example.com', password: 'Password123' });

    expect(mockRefreshTokenRepo.delete).toHaveBeenCalledWith({
      userId: 5,
      expiresAt: LessThan(expect.any(Date)),
    });
    expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
      1,
      { sub: 5, role: RoleName.CLIENT },
      expect.objectContaining({ algorithm: 'HS256' }),
    );
    expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
      2,
      { sub: 5, jti: expect.any(String) },
      expect.objectContaining({ algorithm: 'HS256' }),
    );
  });

  it('revokes all active tokens when rotated token is reused after 10s', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({ sub: 7, jti: 'old-jti' });
    const managerUpdate = jest.fn().mockResolvedValue({});

    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => {
        const qb = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 1,
            userId: 7,
            jti: 'old-jti',
            revokedAt: new Date(Date.now() - 15_000),
            replacedByJti: 'new-jti',
            expiresAt: new Date(Date.now() + 60_000),
          }),
        };
        return cb({
          createQueryBuilder: jest.fn().mockReturnValue(qb),
          update: managerUpdate,
        });
      },
    );

    await expect(service.refresh('raw.refresh.token')).rejects.toMatchObject({
      response: { code: ErrorCode.TOKEN_REVOKED },
    });

    expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
      'raw.refresh.token',
      expect.objectContaining({ algorithms: ['HS256'] }),
    );
    expect(managerUpdate).toHaveBeenCalledWith(
      RefreshToken,
      { userId: 7, revokedAt: IsNull() },
      { revokedAt: expect.any(Date) },
    );
  });

  it('does not revoke other tokens when rotated token is reused within 10s', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({ sub: 7, jti: 'old-jti' });
    const managerUpdate = jest.fn();

    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => {
        const qb = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 1,
            userId: 7,
            jti: 'old-jti',
            revokedAt: new Date(Date.now() - 2_000),
            replacedByJti: 'new-jti',
            expiresAt: new Date(Date.now() + 60_000),
          }),
        };
        return cb({
          createQueryBuilder: jest.fn().mockReturnValue(qb),
          update: managerUpdate,
        });
      },
    );

    await expect(service.refresh('raw.refresh.token')).rejects.toMatchObject({
      response: { code: ErrorCode.TOKEN_REVOKED },
    });
    expect(managerUpdate).not.toHaveBeenCalled();
  });

  it('does not revoke other tokens when logged-out token (no replacedByJti) is refreshed', async () => {
    mockJwtService.verifyAsync.mockResolvedValue({ sub: 7, jti: 'logout-jti' });
    const managerUpdate = jest.fn();

    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => {
        const qb = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: 1,
            userId: 7,
            jti: 'logout-jti',
            revokedAt: new Date(Date.now() - 60_000),
            replacedByJti: null,
            expiresAt: new Date(Date.now() + 60_000),
          }),
        };
        return cb({
          createQueryBuilder: jest.fn().mockReturnValue(qb),
          update: managerUpdate,
        });
      },
    );

    await expect(service.refresh('raw.refresh.token')).rejects.toMatchObject({
      response: { code: ErrorCode.TOKEN_REVOKED },
    });
    expect(managerUpdate).not.toHaveBeenCalled();
  });

  it('logout swallows invalid token verification errors but propagates database errors', async () => {
    mockJwtService.verifyAsync.mockRejectedValueOnce(new Error('bad jwt'));
    await expect(service.logout('bad.token')).resolves.toBeUndefined();
    expect(mockRefreshTokenRepo.update).not.toHaveBeenCalled();

    mockJwtService.verifyAsync.mockResolvedValueOnce({
      sub: 9,
      jti: 'valid-jti',
    });
    mockRefreshTokenRepo.update.mockRejectedValueOnce(
      new Error('db connection lost'),
    );

    await expect(service.logout('valid.token')).rejects.toThrow(
      'db connection lost',
    );
  });
});
