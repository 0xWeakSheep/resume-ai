import { BadRequestException, Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import { isIP } from 'node:net';
import { PDFParse } from 'pdf-parse';
import type {
  CareerFact,
  CareerFactBase,
  CareerFactCategory,
  HardRequirement,
  HardRequirementMatch,
  JobInputSource,
  JobMatchReport,
  JobRequirement,
  JobStandardizeRequest,
  JobStandardizeResponse,
  ParsedJobDescription,
  ParsedResume,
  QualityReport,
  RequirementMapping,
  StandardizedJob,
  ResumeCustomizeRequest,
  ResumeCustomizeResponse,
  ResumeFactResponse,
  ResumeFileKind,
  RewriteSuggestion,
  UploadedResumeFile,
} from './resume.types';

const MAX_TEXT_LENGTH = 80_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const SECTION_MATCHERS: Array<{
  key: keyof ParsedResume['sections'];
  pattern: RegExp;
}> = [
  {
    key: 'experience',
    pattern: /^(工作经历|项目经历|实习经历|experience|projects?)[:：\s]*$/i,
  },
  { key: 'education', pattern: /^(教育经历|教育背景|education)[:：\s]*$/i },
  {
    key: 'skills',
    pattern: /^(技能|专业技能|核心能力|skills?|competencies)[:：\s]*$/i,
  },
  { key: 'summary', pattern: /^(个人简介|自我评价|summary|profile)[:：\s]*$/i },
];

const KNOWN_KEYWORDS = [
  'AI',
  'LLM',
  'RAG',
  'Prompt',
  'Agent',
  'React',
  'Next.js',
  'Node.js',
  'NestJS',
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'Go',
  'SQL',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Docker',
  'Kubernetes',
  'AWS',
  'Azure',
  'GCP',
  'API',
  'CI/CD',
  '测试',
  '自动化',
  '数据分析',
  '用户研究',
  '产品设计',
  '需求分析',
  '项目管理',
  '跨团队协作',
  '增长',
  'SaaS',
  'B端',
  '商业化',
  'A/B测试',
] as const;

const REQUIREMENT_PREFIX =
  /^(\d+[).、]|[-*•·]|[（(]?\d+[）)]|职责[:：]|要求[:：])\s*/;
const METRIC_PATTERN =
  /\d+(?:\.\d+)?\s*(?:%|人|天|周|月|年|倍|万|k|K|次|小时|h|ms|s)?/g;
const URL_FETCH_TIMEOUT_MS = 5000;

@Injectable()
export class ResumeService {
  async customize(body: unknown): Promise<ResumeCustomizeResponse> {
    const request = this.parseRequest(body);
    const resumeText = await this.resolveResumeText(request);
    const jdText = this.requireUsefulText(
      request.jobDescription,
      'jobDescription',
    );
    const answers = this.normalizeText(request.answers ?? '');
    const parsedResume = this.parseResume(
      answers
        ? {
            text: `${resumeText.text}\n\n补充信息\n${answers}`,
            sourceType: resumeText.sourceType,
          }
        : resumeText,
    );
    const parsedJobDescription = this.parseJobDescription(jdText);
    const requirementMappings = this.mapRequirements(
      parsedResume,
      parsedJobDescription,
    );
    const matchedKeywords = this.unique(
      requirementMappings.flatMap((mapping) => mapping.matchedKeywords),
    );
    const missingKeywords = parsedJobDescription.keywords.filter(
      (keyword) => !matchedKeywords.includes(keyword),
    );
    const followUpQuestions = this.buildFollowUpQuestions(
      parsedJobDescription,
      requirementMappings,
      missingKeywords,
    );
    const rewrite = this.buildRewrite(
      parsedResume,
      parsedJobDescription,
      requirementMappings,
      matchedKeywords,
    );
    const quality = this.buildQualityReport(
      parsedResume,
      parsedJobDescription,
      requirementMappings,
      rewrite.rewrittenExperienceBullets,
      missingKeywords,
    );

    return {
      parsedResume,
      parsedJobDescription,
      analysis: {
        requirementMappings,
        matchedKeywords,
        missingKeywords,
        followUpQuestions,
      },
      rewrite,
      quality,
    };
  }

  async extractFacts(body: unknown): Promise<ResumeFactResponse> {
    const request = this.parseRequest(body);
    const resumeText = await this.resolveResumeText(request);
    const answers = this.normalizeText(request.answers ?? '');
    const parsedResume = this.parseResume(
      answers
        ? {
            text: `${resumeText.text}\n\n补充信息\n${answers}`,
            sourceType: resumeText.sourceType,
          }
        : resumeText,
    );
    const factBase = this.buildCareerFactBase(parsedResume);

    return {
      parsedResume,
      factBase,
    };
  }

  async standardizeJobs(body: unknown): Promise<JobStandardizeResponse> {
    const request = this.parseJobStandardizeRequest(body);
    const sources = this.collectJobSources(request);
    const resumeForMatching =
      await this.resolveOptionalResumeForMatching(request);
    const seenSources = new Set<string>();
    const jobs: StandardizedJob[] = [];

    for (const source of sources) {
      const sourceKey = `${source.type}:${source.value.trim().toLowerCase()}`;
      const id = `JOB-${jobs.length + 1}`;

      if (seenSources.has(sourceKey)) {
        jobs.push(
          this.buildFailedStandardizedJob(
            id,
            source,
            'duplicate',
            '重复输入，已跳过处理。',
          ),
        );
        continue;
      }
      seenSources.add(sourceKey);

      if (source.type === 'text') {
        jobs.push(this.standardizeJobText(id, source, source.value));
        continue;
      }

      jobs.push(await this.standardizeJobUrl(id, source));
    }

    const processedJobs = this.rankAndFilterJobs(jobs, resumeForMatching);

    return {
      jobs: processedJobs,
      summary: {
        total: processedJobs.length,
        ready: processedJobs.filter((job) => job.status === 'ready').length,
        failed: processedJobs.filter((job) => job.status === 'failed').length,
        duplicate: processedJobs.filter((job) => job.status === 'duplicate')
          .length,
        ranked: processedJobs.filter(
          (job) => job.status === 'ready' && job.match,
        ).length,
        blocked: processedJobs.filter((job) => job.filterStatus === 'blocked')
          .length,
      },
    };
  }

  private parseRequest(body: unknown): ResumeCustomizeRequest {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    return body;
  }

  private parseJobStandardizeRequest(body: unknown): JobStandardizeRequest {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    return body;
  }

  private collectJobSources(request: JobStandardizeRequest): JobInputSource[] {
    const sources: JobInputSource[] = [];
    const addText = (value: unknown): void => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = this.normalizeText(value);
      if (!normalized) {
        return;
      }

      sources.push({ type: 'text', value: normalized });
    };
    const addUrl = (value: unknown): void => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = value.trim();
      if (!normalized) {
        return;
      }

      sources.push({ type: 'url', value: normalized });
    };

    addText(request.jobDescription);
    request.jobDescriptions?.forEach(addText);
    request.jobUrls?.forEach(addUrl);
    request.sources?.forEach((source) => {
      if (source.type === 'text') {
        addText(source.value);
        return;
      }

      if (source.type === 'url') {
        addUrl(source.value);
      }
    });

    if (sources.length === 0) {
      throw new BadRequestException(
        'At least one JD text or URL source is required.',
      );
    }

    return sources.slice(0, 20);
  }

  private async resolveOptionalResumeForMatching(
    request: JobStandardizeRequest,
  ): Promise<ParsedResume | null> {
    const hasResumeText =
      this.normalizeText(request.resume?.text ?? '').length > 0;
    const hasResumeFile = Boolean(request.resume?.file);

    if (!hasResumeText && !hasResumeFile) {
      return null;
    }

    const resumeText = await this.resolveResumeText(request);
    const answers = this.normalizeText(request.answers ?? '');

    return this.parseResume(
      answers
        ? {
            text: `${resumeText.text}\n\n补充信息\n${answers}`,
            sourceType: resumeText.sourceType,
          }
        : resumeText,
    );
  }

  private async resolveResumeText(
    request: ResumeCustomizeRequest,
  ): Promise<{ text: string; sourceType: ParsedResume['sourceType'] }> {
    const text = this.normalizeText(request.resume?.text ?? '');
    if (text.length > 0) {
      return {
        text: this.requireUsefulText(text, 'resume.text'),
        sourceType: 'plain-text',
      };
    }

    const file = request.resume?.file;
    if (!file) {
      throw new BadRequestException(
        'Either resume.text or resume.file is required.',
      );
    }

    const fileKind = this.detectFileKind(file);
    const buffer = this.decodeBase64(file.dataBase64);
    if (buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException('Resume file must be smaller than 4MB.');
    }

    const parsedText = await this.extractTextFromFile(fileKind, buffer);
    return {
      text: this.requireUsefulText(parsedText, 'resume.file'),
      sourceType: fileKind,
    };
  }

  private detectFileKind(file: UploadedResumeFile): ResumeFileKind {
    const name = file.name.toLowerCase();
    const mimeType = file.mimeType?.toLowerCase() ?? '';

    if (mimeType.includes('pdf') || name.endsWith('.pdf')) {
      return 'pdf';
    }

    if (mimeType.includes('wordprocessingml') || name.endsWith('.docx')) {
      return 'docx';
    }

    if (mimeType.startsWith('text/') || name.endsWith('.txt')) {
      return 'text';
    }

    throw new BadRequestException(
      'Only PDF, DOCX, and TXT resumes are supported.',
    );
  }

  private decodeBase64(value: string): Buffer {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException('resume.file.dataBase64 is required.');
    }

    const normalized = value.includes(',')
      ? value.slice(value.indexOf(',') + 1)
      : value;

    try {
      return Buffer.from(normalized, 'base64');
    } catch {
      throw new BadRequestException('resume.file.dataBase64 is invalid.');
    }
  }

  private async extractTextFromFile(
    kind: ResumeFileKind,
    buffer: Buffer,
  ): Promise<string> {
    if (kind === 'text') {
      return buffer.toString('utf8');
    }

    if (kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    const parser = new PDFParse({ data: Uint8Array.from(buffer) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private parseResume(
    source: string | { text: string; sourceType: ParsedResume['sourceType'] },
    sourceType: ParsedResume['sourceType'] = 'plain-text',
  ): ParsedResume {
    const rawText =
      typeof source === 'string'
        ? this.requireUsefulText(source, 'resume')
        : this.requireUsefulText(source.text, 'resume');
    const detectedSourceType =
      typeof source === 'string' ? sourceType : source.sourceType;
    const sections: ParsedResume['sections'] = {
      summary: [],
      experience: [],
      education: [],
      skills: [],
      other: [],
    };
    const warnings: string[] = [];
    let currentSection: keyof ParsedResume['sections'] = 'summary';

    for (const line of this.toLines(rawText)) {
      const heading = SECTION_MATCHERS.find((matcher) =>
        matcher.pattern.test(line),
      );

      if (heading) {
        currentSection = heading.key;
        continue;
      }

      sections[currentSection].push(line);
    }

    const experienceBullets = this.extractResumeBullets(
      sections.experience.length > 0
        ? sections.experience
        : this.toLines(rawText),
    );
    const skillKeywords = this.unique([
      ...this.extractKeywords(sections.skills.join('\n')),
      ...this.extractKeywords(rawText),
    ]);
    const education = this.extractEducation(sections.education, rawText);

    if (experienceBullets.length === 0) {
      warnings.push('未识别到明确的项目或工作经历，需要人工补充经历段落。');
    }

    if (skillKeywords.length === 0) {
      warnings.push('未识别到明确技能关键词，需要人工确认技能栈。');
    }

    if (education.length === 0) {
      warnings.push('未识别到教育经历，不影响改写但导出前应人工检查。');
    }

    return {
      sourceType: detectedSourceType,
      rawText,
      sections,
      extracted: {
        skills: skillKeywords,
        education,
        experienceBullets,
        keywords: this.extractKeywords(rawText),
      },
      warnings,
    };
  }

  private parseJobDescription(rawText: string): ParsedJobDescription {
    const normalized = this.requireUsefulText(rawText, 'jobDescription');
    const lines = this.toRequirementLines(normalized);
    const requirements = lines.slice(0, 18).map((line, index) => {
      const cleanLine = line.replace(REQUIREMENT_PREFIX, '').trim();
      const type = this.detectRequirementType(cleanLine);

      return {
        id: `REQ-${index + 1}`,
        text: cleanLine,
        type,
        keywords: this.extractKeywords(cleanLine),
      } satisfies JobRequirement;
    });
    const keywords = this.unique([
      ...this.extractKeywords(normalized),
      ...requirements.flatMap((requirement) => requirement.keywords),
    ]);
    const roleTitle = this.detectRoleTitle(normalized);

    return {
      rawText: normalized,
      roleTitle,
      requirements,
      keywords,
      criticalKeywords: keywords.slice(0, 8),
    };
  }

  private standardizeJobText(
    id: string,
    source: JobInputSource,
    rawText: string,
  ): StandardizedJob {
    try {
      const parsedJobDescription = this.parseJobDescription(rawText);
      const normalizedText = parsedJobDescription.rawText;

      return {
        id,
        sourceType: source.type,
        source: source.value,
        status: 'ready',
        roleTitle: parsedJobDescription.roleTitle,
        company: this.detectCompany(normalizedText),
        rawText,
        normalizedText,
        requirements: parsedJobDescription.requirements,
        keywords: parsedJobDescription.keywords,
        criticalKeywords: parsedJobDescription.criticalKeywords,
        hardRequirements: this.extractHardRequirements(parsedJobDescription),
        warnings: [],
      };
    } catch (error) {
      return this.buildFailedStandardizedJob(
        id,
        source,
        'failed',
        error instanceof Error ? error.message : 'JD 标准化失败。',
      );
    }
  }

  private async standardizeJobUrl(
    id: string,
    source: JobInputSource,
  ): Promise<StandardizedJob> {
    const safeUrl = this.parseSafeJobUrl(source.value);
    if (!safeUrl.ok) {
      return this.buildFailedStandardizedJob(
        id,
        source,
        'failed',
        safeUrl.message,
      );
    }

    try {
      const rawText = await this.fetchJobUrlText(safeUrl.url);
      return this.standardizeJobText(id, source, rawText);
    } catch (error) {
      return this.buildFailedStandardizedJob(
        id,
        source,
        'failed',
        error instanceof Error ? error.message : 'JD 页面抓取失败。',
      );
    }
  }

  private buildFailedStandardizedJob(
    id: string,
    source: JobInputSource,
    status: StandardizedJob['status'],
    warning: string,
  ): StandardizedJob {
    return {
      id,
      sourceType: source.type,
      source: source.value,
      status,
      roleTitle: '未识别岗位',
      rawText: '',
      normalizedText: '',
      requirements: [],
      keywords: [],
      criticalKeywords: [],
      hardRequirements: [],
      warnings: [warning],
    };
  }

  private rankAndFilterJobs(
    jobs: StandardizedJob[],
    resume: ParsedResume | null,
  ): StandardizedJob[] {
    const dedupedJobs = this.markSimilarJobs(jobs);
    const matchedJobs = dedupedJobs.map((job) =>
      job.status === 'ready' && resume
        ? this.attachJobMatchReport(job, resume)
        : job,
    );
    const sortedJobs = matchedJobs
      .map((job, index) => ({ job, index }))
      .sort((left, right) => {
        const statusDelta =
          this.getJobStatusSortWeight(left.job) -
          this.getJobStatusSortWeight(right.job);
        if (statusDelta !== 0) {
          return statusDelta;
        }

        const filterDelta =
          this.getJobFilterSortWeight(left.job) -
          this.getJobFilterSortWeight(right.job);
        if (filterDelta !== 0) {
          return filterDelta;
        }

        const scoreDelta =
          (right.job.match?.score ?? 0) - (left.job.match?.score ?? 0);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return left.index - right.index;
      })
      .map((item) => item.job);
    let rank = 1;

    return sortedJobs.map((job) => {
      if (job.status !== 'ready') {
        return job;
      }

      return {
        ...job,
        priorityRank: rank++,
      };
    });
  }

  private markSimilarJobs(jobs: StandardizedJob[]): StandardizedJob[] {
    const representatives: StandardizedJob[] = [];

    return jobs.map((job) => {
      if (job.status !== 'ready') {
        return job;
      }

      const representative = representatives.find((candidate) =>
        this.areSimilarJobs(candidate, job),
      );

      if (representative) {
        return {
          ...job,
          status: 'duplicate',
          duplicateOf: representative.id,
          similarityGroupId: representative.similarityGroupId,
          warnings: [
            ...job.warnings,
            `与 ${representative.id} 高度相似，已作为重复 JD 降级。`,
          ],
        };
      }

      const nextJob = {
        ...job,
        similarityGroupId: `GROUP-${representatives.length + 1}`,
      };
      representatives.push(nextJob);

      return nextJob;
    });
  }

  private areSimilarJobs(
    left: StandardizedJob,
    right: StandardizedJob,
  ): boolean {
    const compactLeft = left.normalizedText.replace(/\s+/g, '').toLowerCase();
    const compactRight = right.normalizedText.replace(/\s+/g, '').toLowerCase();

    if (compactLeft.length > 0 && compactLeft === compactRight) {
      return true;
    }

    const sameRole =
      this.normalizeComparisonToken(left.roleTitle) ===
      this.normalizeComparisonToken(right.roleTitle);
    const keywordSimilarity = this.jaccardSimilarity(
      left.keywords,
      right.keywords,
    );
    const tokenSimilarity = this.jaccardSimilarity(
      this.getJobComparisonTokens(left),
      this.getJobComparisonTokens(right),
    );

    return (
      tokenSimilarity >= 0.72 ||
      (sameRole && Math.max(keywordSimilarity, tokenSimilarity) >= 0.25)
    );
  }

  private getJobComparisonTokens(job: StandardizedJob): string[] {
    return this.unique([
      this.normalizeComparisonToken(job.roleTitle),
      this.normalizeComparisonToken(job.company ?? ''),
      ...job.keywords,
      ...job.requirements.flatMap((requirement) =>
        this.extractKeywords(requirement.text),
      ),
      ...job.hardRequirements.map(
        (requirement) =>
          `${requirement.type}:${this.normalizeComparisonToken(requirement.text).slice(0, 32)}`,
      ),
    ]);
  }

  private attachJobMatchReport(
    job: StandardizedJob,
    resume: ParsedResume,
  ): StandardizedJob {
    const parsedJobDescription = {
      rawText: job.normalizedText,
      roleTitle: job.roleTitle,
      requirements: job.requirements,
      keywords: job.keywords,
      criticalKeywords: job.criticalKeywords,
    } satisfies ParsedJobDescription;
    const mappings = this.mapRequirements(resume, parsedJobDescription);
    const matchedKeywords = this.unique(
      mappings.flatMap((mapping) => mapping.matchedKeywords),
    );
    const missingKeywords = job.keywords.filter(
      (keyword) => !matchedKeywords.includes(keyword),
    );
    const hardRequirementResults = job.hardRequirements.map((requirement) =>
      this.matchHardRequirement(resume, requirement),
    );
    const blockedByHardRequirements = hardRequirementResults.some((result) =>
      this.isBlockingHardRequirement(result),
    );
    const requirementScore = this.averageMatchScore(
      mappings.map((mapping) => mapping.status),
    );
    const keywordScore =
      job.keywords.length === 0
        ? 0
        : matchedKeywords.length / job.keywords.length;
    const hardScore = this.averageMatchScore(
      hardRequirementResults.map((result) => result.status),
      hardRequirementResults.length === 0 ? 1 : 0,
    );
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (keywordScore * 0.45 + requirementScore * 0.35 + hardScore * 0.2) *
            100 -
            (blockedByHardRequirements ? 25 : 0),
        ),
      ),
    );
    const filterStatus: StandardizedJob['filterStatus'] =
      blockedByHardRequirements ? 'blocked' : score >= 55 ? 'pass' : 'review';
    const match = {
      score,
      level: this.toJobMatchLevel(score),
      matchedKeywords,
      missingKeywords,
      hardRequirementResults,
      blockedByHardRequirements,
      reasons: this.buildJobMatchReasons(
        score,
        matchedKeywords,
        missingKeywords,
        hardRequirementResults,
      ),
    } satisfies JobMatchReport;

    return {
      ...job,
      filterStatus,
      match,
      warnings: blockedByHardRequirements
        ? [...job.warnings, '存在未满足硬门槛，建议降级或过滤。']
        : job.warnings,
    };
  }

  private matchHardRequirement(
    resume: ParsedResume,
    requirement: HardRequirement,
  ): HardRequirementMatch {
    const resumeLines = this.toLines(resume.rawText);
    const requirementKeywords = this.extractKeywords(requirement.text);
    const evidence = this.findEvidenceLinesForKeywords(
      resumeLines,
      requirementKeywords,
    );

    if (requirement.type === 'education') {
      const requiredLevel = this.extractEducationLevel(requirement.text);
      const resumeLevel = this.extractEducationLevel(resume.rawText);

      if (requiredLevel > 0 && resumeLevel >= requiredLevel) {
        return { ...requirement, status: 'matched', evidence };
      }

      if (resume.extracted.education.length > 0) {
        return {
          ...requirement,
          status: 'partial',
          evidence:
            evidence.length > 0
              ? evidence
              : resume.extracted.education.slice(0, 2),
        };
      }

      return { ...requirement, status: 'missing', evidence: [] };
    }

    if (requirement.type === 'experience') {
      const requiredYears = this.extractMaxYears(requirement.text);
      const resumeYears = this.extractMaxYears(resume.rawText);

      if (requiredYears > 0 && resumeYears >= requiredYears) {
        return { ...requirement, status: 'matched', evidence };
      }

      if (resumeYears > 0 || evidence.length > 0) {
        return { ...requirement, status: 'partial', evidence };
      }

      return { ...requirement, status: 'missing', evidence: [] };
    }

    if (requirement.type === 'skill' && requirementKeywords.length > 0) {
      const matchedKeywordCount = requirementKeywords.filter((keyword) =>
        resume.rawText.toLowerCase().includes(keyword.toLowerCase()),
      ).length;
      const ratio = matchedKeywordCount / requirementKeywords.length;

      if (ratio >= 0.6) {
        return { ...requirement, status: 'matched', evidence };
      }

      if (matchedKeywordCount > 0) {
        return { ...requirement, status: 'partial', evidence };
      }

      return { ...requirement, status: 'missing', evidence: [] };
    }

    if (evidence.length > 0) {
      return { ...requirement, status: 'matched', evidence };
    }

    return { ...requirement, status: 'missing', evidence: [] };
  }

  private isBlockingHardRequirement(result: HardRequirementMatch): boolean {
    return (
      result.status === 'missing' &&
      ['education', 'experience', 'location', 'language', 'skill'].includes(
        result.type,
      )
    );
  }

  private averageMatchScore(
    statuses: Array<'matched' | 'partial' | 'missing'>,
    emptyScore = 0,
  ): number {
    if (statuses.length === 0) {
      return emptyScore;
    }

    const total = statuses.reduce((sum, status) => {
      if (status === 'matched') {
        return sum + 1;
      }

      if (status === 'partial') {
        return sum + 0.5;
      }

      return sum;
    }, 0);

    return total / statuses.length;
  }

  private buildJobMatchReasons(
    score: number,
    matchedKeywords: string[],
    missingKeywords: string[],
    hardRequirementResults: HardRequirementMatch[],
  ): string[] {
    const missingHardRequirements = hardRequirementResults.filter(
      (result) => result.status === 'missing',
    );

    return [
      `综合匹配分 ${score}，已匹配 ${matchedKeywords.length} 个 JD 关键词。`,
      missingKeywords.length > 0
        ? `缺口关键词：${missingKeywords.slice(0, 6).join('、')}。`
        : '关键 JD 关键词均已在简历中找到证据。',
      missingHardRequirements.length > 0
        ? `未满足硬门槛：${missingHardRequirements
            .slice(0, 3)
            .map((item) => item.text)
            .join('；')}`
        : '未发现阻断型硬门槛缺口。',
    ];
  }

  private getJobStatusSortWeight(job: StandardizedJob): number {
    if (job.status === 'ready') {
      return 0;
    }

    if (job.status === 'duplicate') {
      return 2;
    }

    return 3;
  }

  private getJobFilterSortWeight(job: StandardizedJob): number {
    if (job.filterStatus === 'blocked') {
      return 1;
    }

    return 0;
  }

  private toJobMatchLevel(score: number): JobMatchReport['level'] {
    if (score >= 75) {
      return 'high';
    }

    if (score >= 50) {
      return 'medium';
    }

    if (score >= 25) {
      return 'low';
    }

    return 'unmatched';
  }

  private normalizeComparisonToken(value: string): string {
    return value.replace(/[^\p{L}\p{N}+#./-]+/gu, '').toLowerCase();
  }

  private jaccardSimilarity(left: string[], right: string[]): number {
    const leftSet = new Set(
      left.map((value) => this.normalizeComparisonToken(value)).filter(Boolean),
    );
    const rightSet = new Set(
      right
        .map((value) => this.normalizeComparisonToken(value))
        .filter(Boolean),
    );

    if (leftSet.size === 0 || rightSet.size === 0) {
      return 0;
    }

    const intersection = Array.from(leftSet).filter((value) =>
      rightSet.has(value),
    ).length;
    const union = new Set([...leftSet, ...rightSet]).size;

    return intersection / union;
  }

  private findEvidenceLinesForKeywords(
    lines: string[],
    keywords: string[],
  ): string[] {
    if (keywords.length === 0) {
      return [];
    }

    return lines
      .filter((line) =>
        keywords.some((keyword) =>
          line.toLowerCase().includes(keyword.toLowerCase()),
        ),
      )
      .slice(0, 3);
  }

  private extractEducationLevel(text: string): number {
    if (/博士|phd/i.test(text)) {
      return 3;
    }

    if (/硕士|master/i.test(text)) {
      return 2;
    }

    if (/本科|bachelor/i.test(text)) {
      return 1;
    }

    return 0;
  }

  private extractMaxYears(text: string): number {
    const years = Array.from(text.matchAll(/(\d+)\s*年/g)).map((match) =>
      Number(match[1]),
    );

    return years.length > 0 ? Math.max(...years) : 0;
  }

  private parseSafeJobUrl(
    value: string,
  ): { ok: true; url: URL } | { ok: false; message: string } {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, message: 'JD 链接格式不合法。' };
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, message: 'JD 链接仅支持 HTTP/HTTPS。' };
    }

    if (this.isBlockedFetchHost(url.hostname)) {
      return { ok: false, message: '出于安全限制，不能抓取内网或本机地址。' };
    }

    return { ok: true, url };
  }

  private isBlockedFetchHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    if (['localhost', '0.0.0.0'].includes(normalized)) {
      return true;
    }

    if (normalized.endsWith('.local')) {
      return true;
    }

    if (isIP(normalized) === 0) {
      return false;
    }

    return (
      normalized.startsWith('10.') ||
      normalized.startsWith('127.') ||
      normalized.startsWith('169.254.') ||
      normalized.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
      normalized === '::1'
    );
  }

  private async fetchJobUrlText(url: URL): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          'user-agent':
            'ResumeAI/0.1 (+https://github.com/0xWeakSheep/resume-ai)',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`JD 页面抓取失败：${response.status}`);
      }

      const text = await response.text();
      return this.htmlToText(text);
    } finally {
      clearTimeout(timeout);
    }
  }

  private htmlToText(value: string): string {
    return this.normalizeText(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'"),
    );
  }

  private detectCompany(text: string): string | undefined {
    const companyMatch = text.match(
      /(?:公司|企业|雇主|Company)[:：\s]*(?<company>[^，,。；;\n]{2,40})/i,
    );

    return companyMatch?.groups?.company?.trim();
  }

  private extractHardRequirements(jd: ParsedJobDescription): HardRequirement[] {
    return jd.requirements
      .flatMap((requirement): HardRequirement[] => {
        if (requirement.type === 'preferred') {
          return [];
        }

        const text = requirement.text;
        const hardRequirements: HardRequirement[] = [];

        if (/本科|硕士|博士|学历|bachelor|master|phd/i.test(text)) {
          hardRequirements.push({ type: 'education', text });
        }

        if (/\d+\s*年|经验|experience/i.test(text)) {
          hardRequirements.push({ type: 'experience', text });
        }

        if (/北京|上海|深圳|广州|杭州|成都|远程|onsite|remote/i.test(text)) {
          hardRequirements.push({ type: 'location', text });
        }

        if (/英语|日语|语言|english|japanese|ielts|toefl/i.test(text)) {
          hardRequirements.push({ type: 'language', text });
        }

        if (
          requirement.keywords.length > 0 &&
          /必须|熟悉|掌握|required|must/i.test(text)
        ) {
          hardRequirements.push({ type: 'skill', text });
        }

        if (hardRequirements.length === 0 && requirement.type === 'required') {
          hardRequirements.push({ type: 'other', text });
        }

        return hardRequirements;
      })
      .slice(0, 12);
  }

  private mapRequirements(
    resume: ParsedResume,
    jd: ParsedJobDescription,
  ): RequirementMapping[] {
    const resumeLines = this.toLines(resume.rawText);
    const resumeKeywords = new Set(resume.extracted.keywords);

    return jd.requirements.map((requirement) => {
      const matchedKeywords = requirement.keywords.filter((keyword) =>
        resumeKeywords.has(keyword),
      );
      const evidence = resumeLines
        .filter((line) =>
          matchedKeywords.some((keyword) =>
            line.toLowerCase().includes(keyword.toLowerCase()),
          ),
        )
        .slice(0, 3);
      const status =
        matchedKeywords.length >= 2 || evidence.length >= 2
          ? 'matched'
          : matchedKeywords.length === 1 || evidence.length === 1
            ? 'partial'
            : 'missing';

      return {
        requirementId: requirement.id,
        requirement: requirement.text,
        status,
        matchedKeywords,
        evidence,
        recommendation: this.buildMappingRecommendation(
          status,
          requirement,
          matchedKeywords,
        ),
      };
    });
  }

  private buildRewrite(
    resume: ParsedResume,
    jd: ParsedJobDescription,
    mappings: RequirementMapping[],
    matchedKeywords: string[],
  ): ResumeCustomizeResponse['rewrite'] {
    const strongEvidence = mappings
      .filter((mapping) => mapping.status !== 'missing')
      .flatMap((mapping) => mapping.evidence)
      .filter(Boolean);
    const sourceBullets =
      strongEvidence.length > 0
        ? this.unique(strongEvidence)
        : resume.extracted.experienceBullets;
    const keywordsForRewrite = matchedKeywords.slice(0, 6);
    const rewrittenExperienceBullets = sourceBullets
      .slice(0, 6)
      .map((bullet): RewriteSuggestion => {
        const insertedKeyword = keywordsForRewrite.find(
          (keyword) => !bullet.toLowerCase().includes(keyword.toLowerCase()),
        );
        const after = insertedKeyword
          ? `围绕 ${insertedKeyword}，${this.stripBulletPrefix(bullet)}`
          : this.stripBulletPrefix(bullet);

        return {
          before: bullet,
          after,
          reason: insertedKeyword
            ? `补齐目标 JD 中的 ${insertedKeyword} 表达，但只基于原简历已有经历改写。`
            : '保留原始事实，仅压缩表达并前置与 JD 更相关的信息。',
          evidence: bullet,
        };
      });
    const tailoredSummary = this.buildTailoredSummary(
      resume,
      jd,
      matchedKeywords,
    );
    const modificationReasons = this.buildModificationReasons(
      mappings,
      matchedKeywords,
    );

    return {
      targetRole: jd.roleTitle,
      tailoredSummary,
      rewrittenExperienceBullets,
      skillsToEmphasize: matchedKeywords.slice(0, 10),
      finalResumeMarkdown: this.buildFinalResumeMarkdown(
        jd,
        tailoredSummary,
        rewrittenExperienceBullets,
        matchedKeywords,
      ),
      modificationReasons,
    };
  }

  private buildQualityReport(
    resume: ParsedResume,
    jd: ParsedJobDescription,
    mappings: RequirementMapping[],
    rewrittenBullets: RewriteSuggestion[],
    missingKeywords: string[],
  ): QualityReport {
    const matchedKeywords = this.unique(
      mappings.flatMap((mapping) => mapping.matchedKeywords),
    );
    const totalKeywords = jd.keywords.length;
    const matched = matchedKeywords.length;
    const sourceMetrics = new Set(resume.rawText.match(METRIC_PATTERN) ?? []);
    const inventedMetrics = rewrittenBullets
      .flatMap((suggestion) => suggestion.after.match(METRIC_PATTERN) ?? [])
      .filter((metric) => !sourceMetrics.has(metric));
    const averageBulletLength =
      rewrittenBullets.length === 0
        ? 0
        : Math.round(
            rewrittenBullets.reduce(
              (sum, suggestion) => sum + suggestion.after.length,
              0,
            ) / rewrittenBullets.length,
          );
    const longBulletCount = rewrittenBullets.filter(
      (suggestion) => suggestion.after.length > 110,
    ).length;

    return {
      keywordCoverage: {
        matched,
        total: totalKeywords,
        ratio:
          totalKeywords === 0
            ? 0
            : Number((matched / totalKeywords).toFixed(2)),
        matchedKeywords,
        missingKeywords,
      },
      factConsistency: {
        riskLevel:
          inventedMetrics.length > 0
            ? 'medium'
            : missingKeywords.length > 10
              ? 'medium'
              : 'low',
        issues:
          inventedMetrics.length > 0
            ? [`改写中出现原简历未包含的数字：${inventedMetrics.join('、')}`]
            : ['未发现新增数字成果；缺口能力会进入追问，不直接编造。'],
      },
      readability: {
        averageBulletLength,
        longBulletCount,
        score: Math.max(0, 100 - longBulletCount * 12),
      },
      formatChecks: [
        {
          name: '经历段落',
          passed: resume.extracted.experienceBullets.length > 0,
          detail: '至少需要一段可验证的经历作为改写依据。',
        },
        {
          name: '技能关键词',
          passed: resume.extracted.keywords.length > 0,
          detail: '需要能提取到技能或岗位关键词。',
        },
        {
          name: '岗位要求',
          passed: jd.requirements.length > 0,
          detail: 'JD 需要包含职责或任职要求，才能做映射分析。',
        },
      ],
      manualReviewChecklist: [
        '确认改写后的每条经历都能在原简历或补充信息中找到证据。',
        '补充追问中涉及的缺口能力，无法证明的关键词不要硬塞进简历。',
        '检查数字成果、项目名称、时间范围和角色职责是否真实。',
        '导出前按目标岗位语言统一术语和格式。',
      ],
    };
  }

  private buildCareerFactBase(resume: ParsedResume): CareerFactBase {
    const grouped: Record<CareerFactCategory, CareerFact[]> = {
      profile: [],
      experience: [],
      education: [],
      skill: [],
      metric: [],
      keyword: [],
    };
    const facts: CareerFact[] = [];
    const addFact = (
      category: CareerFactCategory,
      title: string,
      detail: string,
      evidence: string,
      confidence: CareerFact['confidence'],
    ): void => {
      const normalizedDetail = this.normalizeText(detail);
      const normalizedEvidence = this.normalizeText(evidence);
      if (!normalizedDetail || !normalizedEvidence) {
        return;
      }

      const fact = {
        id: `${category.toUpperCase()}-${grouped[category].length + 1}`,
        category,
        title,
        detail: normalizedDetail,
        evidence: normalizedEvidence,
        confidence,
      } satisfies CareerFact;

      grouped[category].push(fact);
      facts.push(fact);
    };

    const lines = this.toLines(resume.rawText);
    const profileLines =
      resume.sections.summary.length > 0
        ? resume.sections.summary
        : lines
            .slice(0, 4)
            .filter(
              (line) =>
                !SECTION_MATCHERS.some((item) => item.pattern.test(line)),
            )
            .filter((line) => !line.startsWith('-'));

    profileLines.slice(0, 3).forEach((line, index) => {
      addFact('profile', `基础信息 ${index + 1}`, line, line, 'medium');
    });

    resume.extracted.experienceBullets.slice(0, 12).forEach((bullet, index) => {
      addFact(
        'experience',
        `经历事实 ${index + 1}`,
        bullet,
        this.findEvidenceLine(lines, bullet),
        'high',
      );
    });

    resume.extracted.education.forEach((education, index) => {
      addFact(
        'education',
        `教育经历 ${index + 1}`,
        education,
        this.findEvidenceLine(lines, education),
        'high',
      );
    });

    resume.extracted.skills.slice(0, 16).forEach((skill) => {
      addFact(
        'skill',
        skill,
        skill,
        this.findEvidenceLine(lines, skill),
        'medium',
      );
    });

    this.unique(resume.rawText.match(METRIC_PATTERN) ?? [])
      .slice(0, 12)
      .forEach((metric) => {
        addFact(
          'metric',
          metric,
          metric,
          this.findEvidenceLine(lines, metric),
          'high',
        );
      });

    resume.extracted.keywords
      .filter((keyword) => !resume.extracted.skills.includes(keyword))
      .slice(0, 16)
      .forEach((keyword) => {
        addFact(
          'keyword',
          keyword,
          keyword,
          this.findEvidenceLine(lines, keyword),
          'low',
        );
      });

    return {
      sourceType: resume.sourceType,
      totalFacts: facts.length,
      facts,
      grouped,
      warnings: resume.warnings,
    };
  }

  private requireUsefulText(
    value: string | undefined,
    fieldName: string,
  ): string {
    const normalized = this.normalizeText(value ?? '');
    if (normalized.length < 20) {
      throw new BadRequestException(
        `${fieldName} must contain at least 20 characters.`,
      );
    }

    if (normalized.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException(
        `${fieldName} must be shorter than 80000 characters.`,
      );
    }

    return normalized;
  }

  private normalizeText(value: string): string {
    return value
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private toLines(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private toRequirementLines(text: string): string[] {
    const lines = this.toLines(text)
      .flatMap((line) => line.split(/(?<=[。；;])\s*/))
      .map((line) => line.trim())
      .filter((line) => line.length >= 8);

    return lines.length > 0 ? lines : [text];
  }

  private detectRequirementType(text: string): JobRequirement['type'] {
    if (/优先|加分|preferred|plus/i.test(text)) {
      return 'preferred';
    }

    if (/负责|职责|推动|设计|搭建|实现|responsib/i.test(text)) {
      return 'responsibility';
    }

    if (/要求|必须|熟悉|掌握|具备|经验|required|must/i.test(text)) {
      return 'required';
    }

    return 'other';
  }

  private detectRoleTitle(text: string): string {
    const lines = this.toLines(text);
    const firstLine = lines[0] ?? '';
    const titleLine =
      lines.find((line) => /(岗位|职位|招聘)[:：\s]/.test(line)) ?? firstLine;
    const titleMatch = titleLine.match(
      /(岗位|职位|招聘)[:：\s]*(?<title>[^，,。；;\n]{2,40})/,
    );

    return (
      titleMatch?.groups?.title?.trim() || firstLine.slice(0, 40) || '目标岗位'
    );
  }

  private extractResumeBullets(lines: string[]): string[] {
    return this.unique(
      lines
        .filter((line) => line.length >= 12)
        .filter((line) =>
          /[-•·]|负责|推动|设计|搭建|实现|优化|提升|降低|协作|led|built|improved/i.test(
            line,
          ),
        )
        .map((line) => this.stripBulletPrefix(line))
        .slice(0, 12),
    );
  }

  private extractEducation(sectionLines: string[], rawText: string): string[] {
    const candidates =
      sectionLines.length > 0 ? sectionLines : this.toLines(rawText);

    return candidates
      .filter((line) =>
        /大学|学院|本科|硕士|博士|bachelor|master|phd|university/i.test(line),
      )
      .slice(0, 5);
  }

  private extractKeywords(text: string): string[] {
    const lowerText = text.toLowerCase();
    const known = KNOWN_KEYWORDS.filter((keyword) =>
      lowerText.includes(keyword.toLowerCase()),
    );
    const acronyms = text.match(/\b[A-Z][A-Z0-9+/#.-]{1,12}\b/g) ?? [];
    const chineseTerms =
      text.match(
        /[\u4e00-\u9fa5A-Za-z0-9./#+-]{2,12}(?:分析|设计|开发|管理|协作|测试|优化|增长|部署|评估|改写|校验)/g,
      ) ?? [];

    return this.unique([...known, ...acronyms, ...chineseTerms]).slice(0, 24);
  }

  private buildMappingRecommendation(
    status: RequirementMapping['status'],
    requirement: JobRequirement,
    matchedKeywords: string[],
  ): string {
    if (status === 'matched') {
      return `已匹配 ${matchedKeywords.join('、')}，建议在简历中前置相关证据。`;
    }

    if (status === 'partial') {
      return `已有部分证据，建议补充与「${requirement.text.slice(0, 28)}」直接相关的结果或场景。`;
    }

    return `暂未发现可靠证据，应先追问真实经历，不要直接编造。`;
  }

  private buildFollowUpQuestions(
    jd: ParsedJobDescription,
    mappings: RequirementMapping[],
    missingKeywords: string[],
  ): string[] {
    const missingRequired = mappings.filter(
      (mapping) =>
        mapping.status === 'missing' &&
        jd.requirements.find(
          (requirement) => requirement.id === mapping.requirementId,
        )?.type !== 'preferred',
    );

    return this.unique([
      ...missingRequired
        .slice(0, 4)
        .map(
          (mapping) =>
            `你是否有与「${mapping.requirement.slice(0, 36)}」相关的真实项目、职责或结果？`,
        ),
      ...missingKeywords
        .slice(0, 4)
        .map(
          (keyword) => `是否有可以证明「${keyword}」能力的项目经历或数据成果？`,
        ),
    ]).slice(0, 6);
  }

  private buildTailoredSummary(
    resume: ParsedResume,
    jd: ParsedJobDescription,
    matchedKeywords: string[],
  ): string[] {
    const mainSkills = matchedKeywords.slice(0, 4);
    const experienceEvidence = resume.extracted.experienceBullets[0];

    return [
      `面向「${jd.roleTitle}」岗位，优先呈现 ${mainSkills.length > 0 ? mainSkills.join('、') : '与 JD 已匹配的'} 相关经验。`,
      experienceEvidence
        ? `核心经历依据：${experienceEvidence}`
        : '当前简历缺少可直接引用的经历段落，需要补充项目事实后再生成最终版本。',
    ];
  }

  private buildModificationReasons(
    mappings: RequirementMapping[],
    matchedKeywords: string[],
  ): string[] {
    return [
      matchedKeywords.length > 0
        ? `将 ${matchedKeywords.slice(0, 6).join('、')} 等 JD 关键词前置。`
        : '当前缺少可匹配关键词，先输出追问而不是强行改写。',
      '每条改写建议保留原简历证据，未在原文出现的缺口能力只进入追问。',
      `共有 ${mappings.filter((mapping) => mapping.status === 'missing').length} 条岗位要求需要补充真实材料。`,
    ];
  }

  private buildFinalResumeMarkdown(
    jd: ParsedJobDescription,
    tailoredSummary: string[],
    rewrittenExperienceBullets: RewriteSuggestion[],
    matchedKeywords: string[],
  ): string {
    const summary = tailoredSummary.map((line) => `- ${line}`).join('\n');
    const bullets =
      rewrittenExperienceBullets.length > 0
        ? rewrittenExperienceBullets
            .map((suggestion) => `- ${suggestion.after}`)
            .join('\n')
        : '- 暂无可安全改写的经历，请先补充真实项目材料。';
    const skills =
      matchedKeywords.length > 0
        ? matchedKeywords.map((keyword) => `\`${keyword}\``).join(' ')
        : '待补充';

    return `# ${jd.roleTitle} 定制简历草稿\n\n## 岗位匹配摘要\n${summary}\n\n## 重点经历改写\n${bullets}\n\n## 建议强调技能\n${skills}\n`;
  }

  private stripBulletPrefix(value: string): string {
    return value
      .replace(REQUIREMENT_PREFIX, '')
      .replace(/^[-*•·]\s*/, '')
      .trim();
  }

  private unique(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }

  private findEvidenceLine(lines: string[], value: string): string {
    const normalizedValue = this.stripBulletPrefix(value).toLowerCase();
    const exact = lines.find((line) =>
      line.toLowerCase().includes(normalizedValue),
    );

    if (exact) {
      return exact;
    }

    const token = normalizedValue.split(/\s+/)[0] ?? normalizedValue;
    return lines.find((line) => line.toLowerCase().includes(token)) ?? value;
  }
}
