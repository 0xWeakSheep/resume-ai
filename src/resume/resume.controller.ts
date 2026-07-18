import { Body, Controller, Post } from '@nestjs/common';
import { ResumeService } from './resume.service';
import type {
  ResumeCustomizeResponse,
  ResumeFactResponse,
} from './resume.types';

@Controller('resume')
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Post('customize')
  customize(@Body() body: unknown): Promise<ResumeCustomizeResponse> {
    return this.resumeService.customize(body);
  }

  @Post('facts')
  facts(@Body() body: unknown): Promise<ResumeFactResponse> {
    return this.resumeService.extractFacts(body);
  }
}
