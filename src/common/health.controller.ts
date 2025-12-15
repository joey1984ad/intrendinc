import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('ready')
  ready() {
    // Add more sophisticated readiness checks here
    // e.g., database connection, external service availability
    return { 
      ready: true, 
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return { 
      live: true, 
      timestamp: new Date().toISOString(),
    };
  }
}
