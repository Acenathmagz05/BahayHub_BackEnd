import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { Role, UserStatus } from '../common';
import { EnvValidationError, validateEnv } from '../config/env.validation';
import { AuthController } from './auth.controller';
import { AuthService, AuthSessionResult } from './auth.service';

describe('AuthController & EnvValidation', () => {
  const baseEnv: Record<string, unknown> = {
    NODE_ENV: 'development',
    PORT: 3000,
    TRUST_PROXY_HOPS: 0,
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bahayhub_test',
    JWT_ACCESS_SECRET: 'access-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'refresh-secret-at-least-32-characters-long',
    COOKIE_SAME_SITE: 'lax',
    CORS_ORIGIN: 'http://localhost:5173',
    CLOUDINARY_CLOUD_NAME: 'cloud',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  };

  describe('AuthController cookie options', () => {
    const sessionResult: AuthSessionResult = {
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
    };

    const makeController = async (
      nodeEnv: string,
      sameSite: 'lax' | 'strict' | 'none',
    ): Promise<{
      controller: AuthController;
      authService: { login: jest.Mock; logout: jest.Mock };
    }> => {
      const authService = {
        register: jest.fn(),
        login: jest.fn().mockResolvedValue(sessionResult),
        refresh: jest.fn(),
        logout: jest.fn().mockResolvedValue(undefined),
        me: jest.fn(),
      };

      const configService = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'NODE_ENV') return nodeEnv;
          if (key === 'COOKIE_SAME_SITE') return sameSite;
          return defaultValue;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: authService },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      return {
        controller: module.get<AuthController>(AuthController),
        authService,
      };
    };

    it('sets secure: true when sameSite is none even if NODE_ENV is not production', async () => {
      const { controller } = await makeController('development', 'none');
      const cookieMock = jest.fn();
      const clearCookieMock = jest.fn();
      const res = {
        cookie: cookieMock,
        clearCookie: clearCookieMock,
      } as unknown as Response;

      await controller.login(
        { email: 'juan@example.com', password: 'Password123' },
        res,
      );

      expect(cookieMock).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          path: '/api/auth',
        }),
      );

      const req = { cookies: { refresh_token: 'refresh-token' } } as Request;
      await controller.logout(req, res);

      expect(clearCookieMock).toHaveBeenCalledWith('refresh_token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/auth',
      });
    });

    it('sets secure: true in production even when sameSite is lax', async () => {
      const { controller } = await makeController('production', 'lax');
      const cookieMock = jest.fn();
      const res = {
        cookie: cookieMock,
      } as unknown as Response;

      await controller.login(
        { email: 'juan@example.com', password: 'Password123' },
        res,
      );

      expect(cookieMock).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/api/auth',
        }),
      );
    });
  });

  describe('validateEnv', () => {
    it('rejects COOKIE_SAME_SITE=none when NODE_ENV is not production', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          NODE_ENV: 'development',
          COOKIE_SAME_SITE: 'none',
        }),
      ).toThrow(EnvValidationError);

      expect(() =>
        validateEnv({
          ...baseEnv,
          NODE_ENV: 'test',
          COOKIE_SAME_SITE: 'none',
        }),
      ).toThrow(
        '"COOKIE_SAME_SITE" may only be "none" when NODE_ENV is "production"',
      );
    });

    it('allows COOKIE_SAME_SITE=none when NODE_ENV is production', () => {
      const validated = validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        COOKIE_SAME_SITE: 'none',
      });

      expect(validated.COOKIE_SAME_SITE).toBe('none');
    });

    it('rejects identical JWT_ACCESS_SECRET and JWT_REFRESH_SECRET', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          JWT_REFRESH_SECRET: baseEnv.JWT_ACCESS_SECRET,
        }),
      ).toThrow(
        '"JWT_REFRESH_SECRET" must be different from "JWT_ACCESS_SECRET"',
      );
    });

    it('defaults TRUST_PROXY_HOPS to 0 and validates non-negative integers', () => {
      const { TRUST_PROXY_HOPS: _omitted, ...withoutProxy } = baseEnv;
      expect(validateEnv(withoutProxy).TRUST_PROXY_HOPS).toBe(0);
      expect(
        validateEnv({ ...baseEnv, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS,
      ).toBe(1);
      expect(() =>
        validateEnv({ ...baseEnv, TRUST_PROXY_HOPS: -1 }),
      ).toThrow(EnvValidationError);
    });
  });
});
