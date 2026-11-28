import path from 'node:path';
import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import {
  EnvConfig,
  EnvValidationError,
  validateEnv,
} from '../config/env.validation';

dotenv.config({ quiet: true });

let env: EnvConfig;
try {
  env = validateEnv(process.env);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  synchronize: false,
  entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
});
