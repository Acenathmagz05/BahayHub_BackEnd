import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ErrorCode, Role, UserStatus } from '../src/common';
import { User } from '../src/users/entities/user.entity';

function configureTestDatabaseEnv(): string {
  dotenv.config({ quiet: true });

  const testDbUrl =
    process.env.DATABASE_URL_TEST ??
    'postgresql://postgres:postgres@localhost:5432/bahayhub_test';

  if (/\/bahayhub_dev(\?|$)/i.test(testDbUrl)) {
    throw new Error('Refusing to run e2e tests against bahayhub_dev');
  }

  process.env.NODE_ENV = 'test';
  process.env.PORT ??= '3000';
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_ACCESS_SECRET ??=
    'test-access-secret-must-be-at-least-32-chars';
  process.env.JWT_REFRESH_SECRET ??=
    'test-refresh-secret-must-be-at-least-32-chars';
  process.env.COOKIE_SAME_SITE ??= 'lax';
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.CLOUDINARY_CLOUD_NAME ??= 'test-cloud';
  process.env.CLOUDINARY_API_KEY ??= 'test-api-key';
  process.env.CLOUDINARY_API_SECRET ??= 'test-api-secret';

  return testDbUrl;
}

function extractCookieValue(
  setCookieHeaders: string[] | string | undefined,
  name: string,
): string | undefined {
  const list = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];

  for (const raw of list) {
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
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "refresh_tokens", "users" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  const registerClient = (overrides?: Record<string, unknown>) => {
    return request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        email: 'Juan.Client@Example.com',
        password: 'Password123',
        phone: '09171234567',
        ...overrides,
      });
  };

  it('registers a client, sets httpOnly refresh cookie, and returns numeric ids without passwordHash', async () => {
    const res = await registerClient().expect(201);

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

    const setCookie = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : '';
    expect(cookieHeader).toContain('refresh_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Path=/api/auth');
  });

  it('rejects client attempting to register with role or status in body', async () => {
    const res = await registerClient({ role: 'admin' }).expect(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

    const res2 = await registerClient({
      email: 'other@example.com',
      status: 'suspended',
    }).expect(400);
    expect(res2.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('logs in, fetches /api/auth/me, and rejects wrong password with INVALID_CREDENTIALS', async () => {
    await registerClient().expect(201);

    const badRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'juan.client@example.com', password: 'WrongPassword1' })
      .expect(401);
    expect(badRes.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'JUAN.CLIENT@example.com', password: 'Password123' })
      .expect(200);

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
      email: 'juan.client@example.com',
    });
    expect(meRes.body.data.passwordHash).toBeUndefined();
  });

  it('rotates refresh token and revokes all active tokens on reuse of a rotated token', async () => {
    const regRes = await registerClient().expect(201);
    const tokenA = extractCookieValue(
      regRes.headers['set-cookie'],
      'refresh_token',
    );
    expect(tokenA).toBeDefined();

    // Rotate A -> B
    const refresh1 = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${tokenA}`])
      .expect(200);

    const tokenB = extractCookieValue(
      refresh1.headers['set-cookie'],
      'refresh_token',
    );
    expect(tokenB).toBeDefined();
    expect(tokenB).not.toBe(tokenA);

    // Reuse rotated token A -> 401 TOKEN_REVOKED and revokes token B too
    const reuseRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${tokenA}`])
      .expect(401);
    expect(reuseRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);

    // Token B must now also be revoked
    const afterTheftRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${tokenB}`])
      .expect(401);
    expect(afterTheftRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('logs out, revokes refresh token, and clears cookie', async () => {
    const regRes = await registerClient().expect(201);
    const accessToken = regRes.body.data.accessToken as string;
    const refreshToken = extractCookieValue(
      regRes.headers['set-cookie'],
      'refresh_token',
    );

    const logoutRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', [`refresh_token=${refreshToken}`])
      .expect(200);

    expect(logoutRes.body.data).toEqual({ loggedOut: true });

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshToken}`])
      .expect(401);
    expect(refreshAfterLogout.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('rejects suspended user on login and on refresh', async () => {
    const regRes = await registerClient().expect(201);
    const userId = regRes.body.data.user.id as number;
    const refreshToken = extractCookieValue(
      regRes.headers['set-cookie'],
      'refresh_token',
    );

    await dataSource
      .getRepository(User)
      .update({ id: userId }, { status: UserStatus.SUSPENDED });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'juan.client@example.com', password: 'Password123' })
      .expect(401);
    expect(loginRes.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshToken}`])
      .expect(401);
    expect(refreshRes.body.error.code).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('throttles login on the 6th attempt in a minute with 429', async () => {
    const throttleEmail = 'throttle.test@example.com';
    await registerClient({ email: throttleEmail }).expect(201);

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: throttleEmail, password: 'WrongPassword1' })
        .expect(401);
    }

    const sixthRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: throttleEmail, password: 'Password123' })
      .expect(429);

    expect(sixthRes.body.error.code).toBe(ErrorCode.TOO_MANY_REQUESTS);
  });
});
