import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  Equals,
  IsDefined,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { Public } from './../src/common';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.PORT ??= '3000';
  process.env.DATABASE_URL ??=
    'postgresql://user:password@localhost:5432/bahayhub_test';
  process.env.JWT_ACCESS_SECRET ??=
    'test-access-secret-must-be-at-least-32-chars';
  process.env.JWT_REFRESH_SECRET ??=
    'test-refresh-secret-must-be-at-least-32-chars';
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.CLOUDINARY_CLOUD_NAME ??= 'test-cloud';
  process.env.CLOUDINARY_API_KEY ??= 'test-api-key';
  process.env.CLOUDINARY_API_SECRET ??= 'test-api-secret';
}

class TestAddressDto {
  @IsString()
  @Equals('Butuan City')
  city!: string;
}

class TestValidationDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => TestAddressDto)
  address!: TestAddressDto;
}

@Controller('test-validation')
class TestValidationController {
  @Public()
  @Post()
  create(@Body() body: TestValidationDto) {
    return body;
  }

  @Public()
  @Get('with-meta')
  withMeta() {
    return {
      data: [{ id: 1 }],
      meta: { page: 1, limit: 12, total: 1, totalPages: 1 },
    };
  }
}

describe('App Bootstrap (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    seedTestEnv();
    const { AppModule } = await import('./../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestValidationController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api returns the success envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api').expect(200);

    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok' },
    });
  });

  it('GET /api/test-validation/with-meta passes meta through in success envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/test-validation/with-meta')
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: [{ id: 1 }],
      meta: { page: 1, limit: 12, total: 1, totalPages: 1 },
    });
  });

  it('GET unknown route returns the 404 NOT_FOUND envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/does-not-exist')
      .expect(404);

    expect(res.body).toEqual({
      success: false,
      error: {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: [],
        path: '/api/does-not-exist',
        timestamp: expect.any(String),
      },
    });
  });

  it('POST invalid payload returns VALIDATION_ERROR with field details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test-validation')
      .send({
        name: 'ab',
        address: { city: 'Davao City' },
        unexpectedField: 'extra',
      })
      .expect(400);

    expect(res.body).toEqual({
      success: false,
      error: {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'name' }),
          expect.objectContaining({ field: 'address.city' }),
          expect.objectContaining({ field: 'unexpectedField' }),
        ]),
        path: '/api/test-validation',
        timestamp: expect.any(String),
      },
    });
  });
});
