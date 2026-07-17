import { Injectable } from '@nestjs/common';

export interface ServiceInfo {
  name: 'resume-ai';
  status: 'ok';
  version: string;
}

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

@Injectable()
export class AppService {
  getServiceInfo(): ServiceInfo {
    return {
      name: 'resume-ai',
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }

  getHealth(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
