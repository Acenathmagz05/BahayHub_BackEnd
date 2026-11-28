import Joi from 'joi';

export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
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
  DATABASE_URL: Joi.string()
    .trim()
    .pattern(/^postgres(ql)?:\/\/.+/)
    .required()
    .messages({
      'string.pattern.base':
        '"DATABASE_URL" must be a valid PostgreSQL URL (postgres:// or postgresql://)',
    }),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  CORS_ORIGIN: Joi.string().trim().min(1).required(),
  CLOUDINARY_CLOUD_NAME: Joi.string().trim().min(1).required(),
  CLOUDINARY_API_KEY: Joi.string().trim().min(1).required(),
  CLOUDINARY_API_SECRET: Joi.string().trim().min(1).required(),
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
