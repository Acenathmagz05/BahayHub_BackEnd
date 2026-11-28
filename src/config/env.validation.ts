import Joi from 'joi';

export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  TRUST_PROXY_HOPS: number;
  DATABASE_URL: string;
  DATABASE_URL_TEST?: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none';
  CORS_ORIGIN: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
}

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export const envValidationSchema = Joi.object<EnvConfig>({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().integer().port().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(0),
  DATABASE_URL: Joi.string()
    .trim()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .required()
    .messages({
      'string.pattern.base':
        '"DATABASE_URL" must be a valid PostgreSQL URL (postgres:// or postgresql://)',
    }),
  DATABASE_URL_TEST: Joi.string()
    .trim()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .optional()
    .messages({
      'string.pattern.base':
        '"DATABASE_URL_TEST" must be a valid PostgreSQL URL (postgres:// or postgresql://)',
    }),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .required()
    .messages({
      'any.invalid':
        '"JWT_REFRESH_SECRET" must be different from "JWT_ACCESS_SECRET"',
    }),
  COOKIE_SAME_SITE: Joi.string()
    .valid('lax', 'strict', 'none')
    .default('lax'),
  CORS_ORIGIN: Joi.string().trim().min(1).required(),
  CLOUDINARY_CLOUD_NAME: Joi.string().trim().min(1).required(),
  CLOUDINARY_API_KEY: Joi.string().trim().min(1).required(),
  CLOUDINARY_API_SECRET: Joi.string().trim().min(1).required(),
}).custom((value: EnvConfig, helpers) => {
  if (value.COOKIE_SAME_SITE === 'none' && value.NODE_ENV !== 'production') {
    return helpers.message({
      custom:
        '"COOKIE_SAME_SITE" may only be "none" when NODE_ENV is "production"',
    });
  }
  return value;
});

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const { error, value } = envValidationSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (error) {
    const lines = error.details.map((detail) => `  - ${detail.message}`);
    throw new EnvValidationError(
      `Invalid environment configuration:\n${lines.join('\n')}`,
    );
  }

  return value;
}
