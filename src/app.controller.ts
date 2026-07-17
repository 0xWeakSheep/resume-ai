import { Controller, Get } from '@nestjs/common';
import { AppService, type HealthStatus, type ServiceInfo } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getServiceInfo(): ServiceInfo {
    return this.appService.getServiceInfo();
  }

  @Get('health')
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
