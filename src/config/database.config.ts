import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NO_SSL ||
    process.env.POSTGRES_CONNECTION_STRING,
}));
