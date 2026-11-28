import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
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
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'access-secret-at-least-32-chars-long';
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret-at-least-32-chars-long';
      return 'value';
    }),
  };

  const mockDataSource = {
    transaction: jest.fn(),
  };

  beforeEach(async () => {
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

  it('registers a client user with lowercased email and hashed password', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    mockRoleRepo.findOne.mockResolvedValue({
      id: 3,
      name: RoleName.CLIENT,
      description: 'Client',
    });

    const now = new Date();
    mockDataSource.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<User>) => {
        const manager = {
          create: jest.fn((_entity: unknown, data: Partial<User>) => ({
            ...data,
            id: 10,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })),
          save: jest.fn((_entity: unknown, user: User) => Promise.resolve(user)),
        };
        return cb(manager);
      },
    );

    mockRefreshTokenRepo.save.mockResolvedValue({});
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
      },
    });
  });

  it('rejects suspended user on login with INVALID_CREDENTIALS', async () => {
    const passwordHash = await bcrypt.hash('Password123', 4);
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

    await expect(
      service.login({ email: 'juan@example.com', password: 'Password123' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
