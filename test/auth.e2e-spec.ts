import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { ErrorCode, Role, UserStatus } from '../src/common';
import { User } from '../src/users/entities/user.entity';

function configureTestDatabaseEnv(): string {
  dotenv.config({ quiet: true });

  const testDbUrl =
    process.env.DATABASE_URL_TEST ??
    'postgresql://postgres:postgres@localhost:5432/bahayhub_test';

  let dbName = '';
  try {
    dbName = new URL(testDbUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`Invalid test database URL: ${testDbUrl}`);
  }

  if (!/_test$/i.test(dbName)) {
    throw new Error(
      `Refusing to run e2e tests: database name "${dbName}" must end with "_test"`,
    );
  }

  process.env.NODE_ENV = 'test';
  process.env.PORT ??= '3000';
  process.env.TRUST_PROXY_HOPS ??= '0';
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_ACCESS_SECRET ??=
    'test-access-secret-must-be-at-least-32-chars';
  process.env.JWT_REFRESH_SECRET ??=
    'test-refresh-secret-must-be-at-least-32-chars';
  process.env.COOKIE_SAME_SITE = 'lax';
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.CLOUDINARY_CLOUD_NAME ??= 'test-cloud';
  process.env.CLOUDINARY_API_KEY ??= 'test-api-key';
  process.env.CLOUDINARY_API_SECRET ??= 'test-api-secret';

  return testDbUrl;
}

function getSetCookieHeaders(
  setCookieHeaders: string[] | string | undefined,
): string[] {
  if (Array.isArray(setCookieHeaders)) {
    return setCookieHeaders;
  }
  return setCookieHeaders ? [setCookieHeaders] : [];
}

function extractCookieValue(
  setCookieHeaders: string[] | string | undefined,
  name: string,
): string | undefined {
  for (const raw of getSetCookieHeaders(setCookieHeaders)) {
    const [pair] = raw.split(';');
    const eqIndex = pair.indexOf('=');
    if (eqIndex > 0 && pair.slice(0, eqIndex).trim() === name) {
      return pair.slice(eqIndex + 1).trim();
    }
  }
  return undefined;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let throttlerStorage: ThrottlerStorageService;
  let emailCounter = 0;

  const uniqueEmail = (prefix = 'client'): string => {
    emailCounter += 1;
    return `${prefix}.${emailCounter}@example.com`;
  };

  beforeAll(async () => {
    const testDbUrl = configureTestDatabaseEnv();

    const migrationDs = new DataSource({
      type: 'postgres',
      url: testDbUrl,
      synchronize: false,
      migrations: ['src/database/migrations/*.ts'],
    });
    await migrationDs.initialize();
    await migrationDs.runMigrations();
    await migrationDs.destroy();

    const { AppModule } = await import('./../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    dataSource = app.get(DataSource);
    jwtService = app.get(JwtService);
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "refresh_tokens", "users" RESTART IDENTITY CASCADE',
    );
    throttlerStorage.storage.clear();
    (
      throttlerStorage as unknown as {
        hitExpirations?: Map<unknown, unknown>;
      }
    ).hitExpirations?.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  const registerClient = (overrides?: Record<string, unknown>) => {
    const email =
      typeof overrides?.email === 'string' ? overrides.email : uniqueEmail();
    return request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        email,
        password: 'Password123',
        phone: '09171234567',
        ...overrides,
      });
  };

  const loginClient = (email: string, password = 'Password123') => {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
  };

  it('registers a client, sets httpOnly refresh cookie, and returns numeric ids without passwordHash', async () => {
    const rawEmail = 'Juan.Client@Example.com';
    const res = await registerClient({ email: rawEmail }).expect(201);

    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.user).toMatchObject({
      id: expect.any(Number),
      roleId: expect.any(Number),
      role: Role.CLIENT,
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      email: 'juan.client@example.com',
      phone: '09171234567',
      status: UserStatus.ACTIVE,
    });
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const cookieHeader = getSetCookieHeaders(res.headers['set-cookie']).join(
      ';',
    );
    expect(cookieHeader).toContain('refresh_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Path=/api/auth');
  });

  it('throttles register on the 6th attempt in a minute from the same IP with 429', async () => {
    for (let i = 0; i < 5; i += 1) {
      await registerClient({ email: uniqueEmail('regthrottle') }).expect(201);
    }

    const sixth = await registerClient({
      email: uniqueEmail('regthrottle'),
    }).expect(429);
    expect(sixth.body.error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
  });

  it('rejects client attempting to register with role or status in body', async () => {
    const res = await registerClient({
      email: uniqueEmail('role'),
      role: 'admin',
    }).expect(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

    const res2 = await registerClient({
      email: uniqueEmail('status'),
      status: 'suspended',
    }).expect(400);
    expect(res2.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('logs in, fetches /api/auth/me, and gives identical INVALID_CREDENTIALS for wrong password and unknown email', async () => {
    const email = uniqueEmail('login');
    await registerClient({ email }).expect(201);

    const wrongPwRes = await loginClient(email, 'WrongPassword1').expect(401);
    const unknownEmailRes = await loginClient(
      uniqueEmail('unknown'),
      'Password123',
    ).expect(401);

    expect(wrongPwRes.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(unknownEmailRes.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(unknownEmailRes.body.error.message).toBe(
      wrongPwRes.body.error.message,
    );

    const loginRes = await loginClient(email.toUpperCase()).expect(200);
    const accessToken = loginRes.body.data.accessToken as string;
    expect(typeof accessToken).toBe('string');
    expect(loginRes.body.data.user.passwordHash).toBeUndefined();

    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.data).toMatchObject({
      id: expect.any(Number),
      role: Role.CLIENT,
      email,
    });
    expect(meRes.body.data.passwordHash).toBeUndefined();
  });

  it('rejects tampered access and refresh tokens and expired refresh tokens', async () => {
    const email = uniqueEmail('tamper');
    const regRes = await registerClient({ email }).expect(201);
    const accessToken = regRes.body.data.accessToken as string;
    const refreshToken = extractCookieValue(
      regRes.headers['set-cookie'],
      'refresh_token',
    )!;

    const flipLastChar = (token: string): string => {
      const last = token.slice(-1);
      return token.slice(0, -1) + (last === 'a' ? 'b' : 'a');
    };

    const tamperedMe = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${flipLastChar(accessToken)}`)
      .expect(401);
    expect(tamperedMe.body.error.code).toBe(ErrorCode.UNAUTHORIZED);

    const tamperedRefresh = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${flipLastChar(refreshToken)}`])
      .expect(401);
    expect(tamperedRefresh.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    const expiredRefreshToken = await jwtService.signAsync(
      { sub: regRes.body.data.user.id, jti: '11111111-1111-4111-8111-111111111111' },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '-1s',
        algorithm: 'HS256',
      },
    );

    const expiredRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${expiredRefreshToken}`])
      .expect(401);
    expect(expiredRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('revokes all active user sessions when a rotated token is reused after 10s', async () => {
    const email = uniqueEmail('theft');
    const regRes = await registerClient({ email }).expect(201);
    const userId = regRes.body.data.user.id as number;

    const session1 = await loginClient(email).expect(200);
    const token1A = extractCookieValue(
      session1.headers['set-cookie'],
      'refresh_token',
    )!;

    const session2 = await loginClient(email).expect(200);
    const token2 = extractCookieValue(
      session2.headers['set-cookie'],
      'refresh_token',
    )!;

    // Rotate session 1: token1A -> token1B
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token1A}`])
      .expect(200);

    // Move revoked_at outside the 10s concurrent-refresh grace window
    await dataSource.query(
      `UPDATE "refresh_tokens"
       SET "revoked_at" = now() - interval '15 seconds'
       WHERE "user_id" = $1 AND "replaced_by_jti" IS NOT NULL`,
      [userId],
    );

    // Reuse rotated token1A -> 401 TOKEN_REVOKED
    const reuseRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token1A}`])
      .expect(401);
    expect(reuseRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    // Unrelated session 2 must also be revoked
    const session2Res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token2}`])
      .expect(401);
    expect(session2Res.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    const rows = (await dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM "refresh_tokens"
       WHERE "user_id" = $1 AND "revoked_at" IS NULL`,
      [userId],
    )) as Array<{ count: number }>;
    expect(rows[0]?.count).toBe(0);
  });

  it('does not revoke other sessions on concurrent refresh within 10s', async () => {
    const email = uniqueEmail('concurrent');
    await registerClient({ email }).expect(201);

    const session1 = await loginClient(email).expect(200);
    const token1A = extractCookieValue(
      session1.headers['set-cookie'],
      'refresh_token',
    )!;

    const session2 = await loginClient(email).expect(200);
    const token2 = extractCookieValue(
      session2.headers['set-cookie'],
      'refresh_token',
    )!;

    // Rotate session 1: token1A -> token1B
    const rotRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token1A}`])
      .expect(200);
    const token1B = extractCookieValue(
      rotRes.headers['set-cookie'],
      'refresh_token',
    )!;

    // Re-presenting token1A within 10s returns 401 TOKEN_REVOKED
    const concurrentRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token1A}`])
      .expect(401);
    expect(concurrentRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    // Unrelated session 2 and rotated token1B remain valid
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token2}`])
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token1B}`])
      .expect(200);
  });

  it('logs out without Authorization header, clears cookie, and revokes only that token', async () => {
    const email = uniqueEmail('logout');
    await registerClient({ email }).expect(201);

    const session1 = await loginClient(email).expect(200);
    const token1 = extractCookieValue(
      session1.headers['set-cookie'],
      'refresh_token',
    )!;

    const session2 = await loginClient(email).expect(200);
    const token2 = extractCookieValue(
      session2.headers['set-cookie'],
      'refresh_token',
    )!;

    // Logout without Authorization header
    const logoutRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', [`refresh_token=${token1}`])
      .expect(200);

    expect(logoutRes.body.data).toEqual({ loggedOut: true });

    const clearedCookie = getSetCookieHeaders(logoutRes.headers['set-cookie']).find(
      (c) => c.startsWith('refresh_token='),
    );
    expect(clearedCookie).toBeDefined();
    expect(clearedCookie).toMatch(/^refresh_token=;/);
    expect(clearedCookie).toContain('Path=/api/auth');
    expect(clearedCookie).toMatch(/Expires=[^;]*1970/i);

    // Token1 is now revoked
    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token1}`])
      .expect(401);
    expect(refreshAfterLogout.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    // Logout of already-revoked token1 returns 200 and leaves session 2 active
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', [`refresh_token=${token1}`])
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token2}`])
      .expect(200);
  });

  it('rejects suspended and soft-deleted users on login and on refresh', async () => {
    // Suspended user
    const suspendedEmail = uniqueEmail('suspended');
    const regSuspended = await registerClient({ email: suspendedEmail }).expect(
      201,
    );
    const suspendedId = regSuspended.body.data.user.id as number;
    const suspendedRefresh = extractCookieValue(
      regSuspended.headers['set-cookie'],
      'refresh_token',
    )!;

    await dataSource
      .getRepository(User)
      .update({ id: suspendedId }, { status: UserStatus.SUSPENDED });

    const suspendedLogin = await loginClient(suspendedEmail).expect(401);
    expect(suspendedLogin.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

    const suspendedRefreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${suspendedRefresh}`])
      .expect(401);
    expect(suspendedRefreshRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    // Soft-deleted user
    const deletedEmail = uniqueEmail('deleted');
    const regDeleted = await registerClient({ email: deletedEmail }).expect(201);
    const deletedId = regDeleted.body.data.user.id as number;
    const deletedRefresh = extractCookieValue(
      regDeleted.headers['set-cookie'],
      'refresh_token',
    )!;

    await dataSource.getRepository(User).softDelete(deletedId);

    const deletedLogin = await loginClient(deletedEmail).expect(401);
    expect(deletedLogin.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

    const deletedRefreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${deletedRefresh}`])
      .expect(401);
    expect(deletedRefreshRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('deletes expired refresh tokens on successful login', async () => {
    const email = uniqueEmail('cleanup');
    const regRes = await registerClient({ email }).expect(201);
    const userId = regRes.body.data.user.id as number;

    await dataSource.query(
      `INSERT INTO "refresh_tokens" ("user_id", "jti", "expires_at")
       VALUES ($1, '22222222-2222-4222-8222-222222222222', now() - interval '1 day')`,
      [userId],
    );

    await loginClient(email).expect(200);

    const expiredRows = (await dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM "refresh_tokens"
       WHERE "user_id" = $1 AND "jti" = '22222222-2222-4222-8222-222222222222'`,
      [userId],
    )) as Array<{ count: number }>;
    expect(expiredRows[0]?.count).toBe(0);
  });

  it('throttles login on the 6th attempt and shares one bucket across email case/space variants', async () => {
    const email = uniqueEmail('throttle');
    await registerClient({ email }).expect(201);

    const variants = [
      `  ${email.toUpperCase()}  `,
      email.toUpperCase(),
      ` ${email}`,
      `${email} `,
      email,
    ];

    for (const variant of variants) {
      await loginClient(variant, 'WrongPassword1').expect(401);
    }

    const sixthRes = await loginClient(`  ${email.toUpperCase()}`).expect(429);
    expect(sixthRes.body.error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
  });

  it('sets HttpOnly, Secure, SameSite=None, and Path=/api/auth when COOKIE_SAME_SITE=none in production', async () => {
    const mockAuthService = {
      login: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 1,
          roleId: 3,
          role: Role.CLIENT,
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          email: 'juan@example.com',
          phone: null,
          status: UserStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'COOKIE_SAME_SITE') return 'none';
        return defaultValue;
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    const prodApp = moduleFixture.createNestApplication();
    prodApp.setGlobalPrefix('api');
    prodApp.use(cookieParser());
    await prodApp.init();

    try {
      const res = await request(prodApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'juan@example.com', password: 'Password123' })
        .expect(200);

      const cookieHeader = getSetCookieHeaders(res.headers['set-cookie']).find(
        (c) => c.startsWith('refresh_token='),
      );
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=None');
      expect(cookieHeader).toContain('Path=/api/auth');
    } finally {
      await prodApp.close();
    }
  });
});
