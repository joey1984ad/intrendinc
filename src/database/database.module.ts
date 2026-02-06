import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('database.url'),
        autoLoadEntities: true, // Automatically load entities from feature modules
        synchronize: true,
        ssl: {
          rejectUnauthorized: false, // Required for Neon PostgreSQL
        },
        logging: false, // Disabled for cleaner auth debugging
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
