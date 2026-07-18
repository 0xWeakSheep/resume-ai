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
  RoleRecommendation,
  RoleRecommendationLevel,
  RoleRecommendationRequest,
  RoleRecommendationResponse,
  StandardizedJob,
  ResumeCustomizeRequest,
  ResumeCustomizeResponse,
  ResumeFactResponse,
  ResumeFileKind,
  RewriteSuggestion,
  SourceFactReference,
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
  'Web3',
  'Blockchain',
  'Solidity',
  'EVM',
  'DeFi',
  'MPT',
  'TxPool',
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
const EXPERIENCE_ACTION_PATTERN =
  /负责|推动|设计|搭建|实现|优化|提升|降低|协作|主导|参与|开发|构建|落地|上线|复盘|沉淀|梳理|维护|集成|验证|交付|led|built|improved|designed|implemented|owned|shipped|launched|optimized|collaborated/i;
const EXPERIENCE_CONTEXT_PATTERN =
  /项目|经历|系统|平台|流程|模块|策略|交易|节点|合约|产品|业务|用户|团队|模型|数据|安全|审计|增长|实验|protocol|system|platform|pipeline|research|security/i;
const CONTACT_LINE_PATTERN =
  /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/|www\.|github\.com|linkedin\.com|电话|手机|邮箱|邮件|微信|wechat|telegram|地址|所在地)/i;
const PROFILE_HEADING_PATTERN =
  /^(姓名|邮箱|邮件|电话|手机|微信|wechat|telegram|github|linkedin|个人网站|地址|所在地|求职意向|个人信息)[:：\s]/i;
const ROLE_ONLY_LINE_PATTERN =
  /^[\p{L}\p{N} .·()（）&+/,-]{2,60}\s*(?:\||｜|—|–|-)\s*(?:核心成员|成员|负责人|创始人|联合创始人|实习生|工程师|开发者|研究员|产品经理|顾问|leader|member|founder|engineer|developer|researcher|intern)\s*$/iu;
const JD_NOISE_PATTERN =
  /(?:cookie|privacy policy|terms of (?:use|service)|all rights reserved|equal opportunity|sign in|log in|register|subscribe|share this job|save job|apply now|job alert|related jobs|similar jobs|about us|contact us|隐私政策|隐私声明|用户协议|服务条款|版权所有|登录|注册|订阅|分享职位|收藏职位|立即申请|申请职位|职位提醒|相似职位|相关职位|联系我们|关于我们|扫码|二维码|下载\s*(?:app|客户端))/i;
const JD_SECTION_BOUNDARY_PATTERN =
  /^(?:福利待遇|薪资福利|我们提供|公司介绍|团队介绍|为什么加入我们|工作地点|申请方式|招聘流程|其他信息|benefits?|our benefits|employee benefits|what we offer|why (?:join us|binance)|working at binance|about (?:us|binance|the company|the team)|compensation|location|how to apply|equal opportunity)\s*[:：]?$/i;
const JD_REQUIREMENT_SIGNAL_PATTERN =
  /(?:负责|参与|协作|推动|设计|搭建|实现|开发|维护|优化|研究|分析|管理|支持|熟悉|掌握|具备|要求|必须|能够|能力|经验|学历|本科|硕士|博士|优先|加分|responsib|develop|build|design|implement|maintain|optimi[sz]e|research|analy[sz]e|manage|support|collaborat|participat|assist|proficien|familiar|knowledge|ability|skills?|experience|qualification|required|must|preferred|degree|bachelor|master|phd)/i;
const SOFT_REQUIREMENT_PATTERN =
  /(?:不限|无需|不要求|非必需|可选|可接受|优先|加分|nice to have|preferred|optional|not required|no requirement)/i;
const EXPLICIT_HARD_REQUIREMENT_PATTERN =
  /(?:必须|要求|需具备|至少|及以上|以上|不得|仅限|required|must|minimum|at least|\d+\s*\+\s*(?:years?|年))/i;
const GENERIC_MATCH_KEYWORDS = new Set([
  'AI',
  'API',
  '测试',
  '自动化',
  '数据分析',
  '用户研究',
  '产品设计',
  '需求分析',
  '项目管理',
  '跨团队协作',
  '增长',
]);
const KEYWORD_STOPWORDS = new Set([
  'APP',
  'CSS',
  'FAQ',
  'HTML',
  'HTTP',
  'HTTPS',
  'HR',
  'JD',
  'JOB',
  'SEO',
  'UI',
  'URL',
  'UX',
]);
const UNSUPPORTED_CLAIM_PATTERN =
  /精通|专家|丰富经验|多年经验|主导|独立负责|从\s*[0零]\s*到\s*1|从零|大规模|高并发|生产级|行业领先|显著提升|大幅提升|主网套利|实战套利/i;

interface JobRequirementCandidate {
  text: string;
  typeHint?: JobRequirement['type'];
}

interface ModelRewriteBullet {
  sourceFactId: string;
  after: string;
  reason?: string;
}

interface ModelRewriteOutput {
  tailoredSummary?: string[];
  rewrittenExperienceBullets?: ModelRewriteBullet[];
  skillsToEmphasize?: string[];
  modificationReasons?: string[];
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface RoleRecommendationTemplate {
  roleTitle: string;
  roleDescription: string;
  keywords: string[];
  gapHints: string[];
}

const ROLE_RECOMMENDATION_TEMPLATES: RoleRecommendationTemplate[] = [
  {
    roleTitle: 'AI 产品经理',
    roleDescription:
      '负责 AI 应用场景定义、需求拆解、数据/算法/研发协作和上线效果评估。',
    keywords: [
      'AI',
      'LLM',
      'RAG',
      'Prompt',
      'Agent',
      '产品设计',
      '需求分析',
      '数据分析',
      '跨团队协作',
      'A/B测试',
    ],
    gapHints: [
      '补充 AI 产品指标、用户场景和上线后的业务结果。',
      '明确你与算法、研发、业务团队之间的职责边界。',
      '补充 Prompt、RAG、Agent 或模型评估相关证据。',
    ],
  },
  {
    roleTitle: 'AI 应用工程师',
    roleDescription:
      '围绕 LLM/RAG/Agent 能力搭建业务应用、后端接口、检索流程和自动化工作流。',
    keywords: [
      'AI',
      'LLM',
      'RAG',
      'Prompt',
      'Agent',
      'Node.js',
      'NestJS',
      'TypeScript',
      'Python',
      'API',
      '自动化',
    ],
    gapHints: [
      '补充模型调用、检索链路、评测方式或线上稳定性指标。',
      '说明你负责的是应用层、后端链路还是模型/数据协作。',
      '补充可复用组件、接口性能或成本优化证据。',
    ],
  },
  {
    roleTitle: 'Web3 安全研究员',
    roleDescription:
      '分析区块链协议、智能合约和链上系统风险，输出漏洞复现、审计和安全复盘。',
    keywords: [
      'Web3',
      'Blockchain',
      'Solidity',
      'EVM',
      'DeFi',
      '安全',
      '审计',
      '漏洞',
      '复盘',
      '智能合约',
    ],
    gapHints: [
      '补充真实漏洞类型、复现过程、影响范围和修复建议。',
      '沉淀合约审计 checklist、工具链或报告样例。',
      '补充链上数据分析、协议机制或安全研究产出。',
    ],
  },
  {
    roleTitle: '区块链基础设施工程师',
    roleDescription:
      '参与链节点、交易池、共识/存储结构和链上基础设施的设计、实现与排障。',
    keywords: [
      'Blockchain',
      'Web3',
      'EVM',
      'MPT',
      'TxPool',
      '交易',
      '节点',
      'Go',
      '系统',
      '协议',
    ],
    gapHints: [
      '补充节点同步、交易排序、存储结构或性能优化细节。',
      '说明你在协议设计、工程实现或问题复现中的具体职责。',
      '补充压测、稳定性、吞吐量或异常处理数据。',
    ],
  },
  {
    roleTitle: '后端/NestJS 工程师',
    roleDescription:
      '负责 Node.js/NestJS 服务、API、数据库、队列、权限和部署链路的工程实现。',
    keywords: [
      'Node.js',
      'NestJS',
      'TypeScript',
      'JavaScript',
      'API',
      'PostgreSQL',
      'MySQL',
      'MongoDB',
      'Redis',
      'Docker',
      'CI/CD',
    ],
    gapHints: [
      '补充接口规模、性能指标、数据库设计和线上稳定性证据。',
      '说明你负责的模块边界、鉴权、日志、部署或监控能力。',
      '补充测试覆盖、故障处理或系统重构结果。',
    ],
  },
  {
    roleTitle: '前端/Next.js 工程师',
    roleDescription:
      '负责 React/Next.js 页面、交互状态、性能优化、组件体系和前后端联调。',
    keywords: [
      'React',
      'Next.js',
      'TypeScript',
      'JavaScript',
      '性能',
      '前端',
      '组件',
      '交互',
    ],
    gapHints: [
      '补充页面性能、组件复用、状态管理或可访问性优化证据。',
      '说明你在设计还原、交互细节和前后端联调中的职责。',
      '补充上线数据、转化率或用户行为反馈。',
    ],
  },
  {
    roleTitle: '增长产品经理',
    roleDescription:
      '围绕获客、激活、留存和转化设计增长实验，用数据分析推动产品迭代。',
    keywords: [
      '增长',
      '数据分析',
      'A/B测试',
      'SaaS',
      '商业化',
      'B端',
      '产品设计',
      '需求分析',
      '用户研究',
    ],
    gapHints: [
      '补充实验设计、样本规模、关键指标和增长结果。',
      '说明你如何从数据发现问题并推动产品改动。',
      '补充商业化、漏斗转化、留存或付费相关证据。',
    ],
  },
  {
    roleTitle: '数据产品经理',
    roleDescription:
      '负责指标体系、数据看板、分析平台和业务决策支持，连接数据、产品与业务团队。',
    keywords: [
      '数据分析',
      'SQL',
      '产品设计',
      '需求分析',
      '指标',
      '看板',
      '增长',
      '跨团队协作',
    ],
    gapHints: [
      '补充指标体系、SQL/看板建设和业务复盘场景。',
      '说明数据口径、权限、报表或实验分析的具体贡献。',
      '补充数据驱动产品决策后的业务结果。',
    ],
  },
];

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
    const factBase = this.buildCareerFactBase(parsedResume);
    const requirementMappings = this.mapRequirements(
      parsedResume,
      parsedJobDescription,
      factBase,
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
    const rewrite = await this.buildRewrite(
      parsedResume,
      parsedJobDescription,
      requirementMappings,
      matchedKeywords,
      factBase,
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

  async recommendRoles(body: unknown): Promise<RoleRecommendationResponse> {
    const request = this.parseRoleRecommendationRequest(body);
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
    const recommendations = this.buildRoleRecommendations(
      parsedResume,
      factBase,
    );

    return {
      parsedResume,
      factBase,
      recommendations,
      summary: {
        total: recommendations.length,
        strong: recommendations.filter((item) => item.level === 'strong')
          .length,
        possible: recommendations.filter((item) => item.level === 'possible')
          .length,
        weak: recommendations.filter((item) => item.level === 'weak').length,
      },
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

  private parseRoleRecommendationRequest(
    body: unknown,
  ): RoleRecommendationRequest {
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
    const file = request.resume?.file;
    if (file) {
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

    const text = this.normalizeText(request.resume?.text ?? '');
    if (text.length > 0) {
      return {
        text: this.requireUsefulText(text, 'resume.text'),
        sourceType: 'plain-text',
      };
    }

    throw new BadRequestException(
      'Either resume.file or resume.text is required.',
    );
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
    const candidates = this.toRequirementCandidates(normalized);
    const requirements = candidates.slice(0, 18).map((candidate, index) => {
      const type = this.detectRequirementType(
        candidate.text,
        candidate.typeHint,
      );

      return {
        id: `REQ-${index + 1}`,
        text: candidate.text,
        type,
        keywords: this.extractKeywords(candidate.text),
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

  private buildRoleRecommendations(
    resume: ParsedResume,
    factBase: CareerFactBase,
  ): RoleRecommendation[] {
    const recommendations = ROLE_RECOMMENDATION_TEMPLATES.map(
      (template, index) => {
        const matchedKeywords = this.unique(
          template.keywords.filter((keyword) =>
            this.includesKeyword(resume.rawText, keyword),
          ),
        );
        const matchedFacts = this.findRoleMatchedFacts(
          factBase,
          matchedKeywords,
        );
        const keywordRatio =
          matchedKeywords.length / Math.min(template.keywords.length, 8);
        const evidenceRatio = Math.min(matchedFacts.length, 4) / 4;
        const categoryBoost =
          (matchedFacts.some((fact) => fact.category === 'experience')
            ? 0.12
            : 0) +
          (matchedFacts.some((fact) => fact.category === 'skill') ? 0.08 : 0) +
          (matchedFacts.some((fact) => fact.category === 'metric') ? 0.05 : 0);
        const relevanceScore = Math.max(
          0,
          Math.min(
            96,
            Math.round(
              (keywordRatio * 0.62 + evidenceRatio * 0.23 + categoryBoost) *
                100,
            ),
          ),
        );
        const level = this.toRoleRecommendationLevel(relevanceScore);
        const gaps = template.gapHints.slice(0, level === 'strong' ? 2 : 3);

        return {
          id: `ROLE-${index + 1}`,
          roleTitle: template.roleTitle,
          roleDescription: template.roleDescription,
          relevanceScore,
          level,
          matchedKeywords,
          matchedFacts,
          gaps,
          reason:
            matchedKeywords.length > 0
              ? `简历中匹配到 ${matchedKeywords.slice(0, 6).join('、')}，并找到 ${matchedFacts.length} 条可追溯事实。`
              : '当前简历缺少该方向的明确关键词或经历证据。',
        } satisfies RoleRecommendation;
      },
    )
      .filter(
        (recommendation) =>
          recommendation.relevanceScore > 0 ||
          recommendation.matchedFacts.length > 0,
      )
      .sort((left, right) => {
        const scoreDelta = right.relevanceScore - left.relevanceScore;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return right.matchedFacts.length - left.matchedFacts.length;
      })
      .slice(0, 6);

    return recommendations.map((recommendation, index) => ({
      ...recommendation,
      id: `ROLE-${index + 1}`,
    }));
  }

  private findRoleMatchedFacts(
    factBase: CareerFactBase,
    matchedKeywords: string[],
  ): SourceFactReference[] {
    if (matchedKeywords.length === 0) {
      return [];
    }

    return factBase.facts
      .map((fact) => {
        const factText = `${fact.title}\n${fact.detail}`;
        const detailHits = matchedKeywords.filter((keyword) =>
          this.includesKeyword(factText, keyword),
        ).length;
        const evidenceHits = matchedKeywords.filter((keyword) =>
          this.includesKeyword(fact.evidence, keyword),
        ).length;
        const keywordHits =
          fact.category === 'skill' || fact.category === 'keyword'
            ? detailHits
            : Math.max(detailHits, evidenceHits);
        const categoryBoost =
          fact.category === 'experience'
            ? 2
            : fact.category === 'metric' || fact.category === 'skill'
              ? 1
              : 0;

        return {
          fact,
          score: keywordHits * 3 + categoryBoost,
        };
      })
      .filter((item) => item.score > 0 && item.score >= 3)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((item) => this.toSourceFactReference(item.fact));
  }

  private toRoleRecommendationLevel(score: number): RoleRecommendationLevel {
    if (score >= 72) {
      return 'strong';
    }

    if (score >= 42) {
      return 'possible';
    }

    return 'weak';
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
        ? [
            ...job.warnings,
            '存在未满足硬门槛，需要人工复核；可继续生成，但不要补写无法证明的能力。',
          ]
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
        this.includesKeyword(resume.rawText, keyword),
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
      .filter((line) => !this.isNonEvidenceLine(line))
      .filter((line) =>
        keywords.some((keyword) => this.includesKeyword(line, keyword)),
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
        if (
          requirement.type === 'preferred' ||
          SOFT_REQUIREMENT_PATTERN.test(requirement.text)
        ) {
          return [];
        }

        const text = requirement.text;
        const hardRequirements: HardRequirement[] = [];
        const hasExplicitHardSignal =
          EXPLICIT_HARD_REQUIREMENT_PATTERN.test(text);

        if (
          hasExplicitHardSignal &&
          /本科|硕士|博士|学历|bachelor|master|phd|degree/i.test(text)
        ) {
          hardRequirements.push({ type: 'education', text });
        }

        if (
          hasExplicitHardSignal &&
          /\d+\s*(?:年|years?)|经验|experience/i.test(text)
        ) {
          hardRequirements.push({ type: 'experience', text });
        }

        if (
          hasExplicitHardSignal &&
          /(?:工作地点|办公地点|常驻|驻场|位于|located in|based in|onsite)/i.test(
            text,
          )
        ) {
          hardRequirements.push({ type: 'location', text });
        }

        if (
          hasExplicitHardSignal &&
          /英语|日语|语言|english|japanese|ielts|toefl/i.test(text)
        ) {
          hardRequirements.push({ type: 'language', text });
        }

        if (
          hasExplicitHardSignal &&
          requirement.keywords.length > 0 &&
          /必须|熟悉|掌握|需具备|required|must|proficien|familiar/i.test(text)
        ) {
          hardRequirements.push({ type: 'skill', text });
        }

        if (
          hardRequirements.length === 0 &&
          requirement.type === 'required' &&
          hasExplicitHardSignal
        ) {
          hardRequirements.push({ type: 'other', text });
        }

        return hardRequirements;
      })
      .slice(0, 12);
  }

  private mapRequirements(
    resume: ParsedResume,
    jd: ParsedJobDescription,
    factBase: CareerFactBase = this.buildCareerFactBase(resume),
  ): RequirementMapping[] {
    const traceableFacts = factBase.facts.filter(
      (fact) =>
        ['experience', 'skill', 'education'].includes(fact.category) &&
        !this.isNonEvidenceLine(fact.evidence),
    );

    return jd.requirements.map((requirement) => {
      const keywordMatches = requirement.keywords.map((keyword) => ({
        keyword,
        facts: traceableFacts.filter((fact) =>
          this.includesKeyword(`${fact.detail}\n${fact.evidence}`, keyword),
        ),
      }));
      const rawSupportedMatches = keywordMatches.filter(
        (match) => match.facts.length > 0,
      );
      const specificSupportedMatches = rawSupportedMatches.filter(
        (match) => !GENERIC_MATCH_KEYWORDS.has(match.keyword),
      );
      const supportedMatches =
        specificSupportedMatches.length === 0 && rawSupportedMatches.length < 2
          ? []
          : rawSupportedMatches;
      const matchedKeywords = supportedMatches.map((match) => match.keyword);
      const matchedFacts = Array.from(
        new Map(
          supportedMatches
            .flatMap((match) => match.facts)
            .map((fact) => [fact.id, fact] as const),
        ).values(),
      ).sort((left, right) => {
        const categoryWeight = (fact: CareerFact): number =>
          fact.category === 'experience'
            ? 0
            : fact.category === 'skill'
              ? 1
              : 2;
        return categoryWeight(left) - categoryWeight(right);
      });
      const evidence = this.unique(
        matchedFacts.map((fact) => fact.evidence),
      ).slice(0, 3);
      const keywordCoverage =
        requirement.keywords.length === 0
          ? 0
          : matchedKeywords.length / requirement.keywords.length;
      const specificMatchedKeywords = matchedKeywords.filter(
        (keyword) => !GENERIC_MATCH_KEYWORDS.has(keyword),
      );
      const experienceFacts = matchedFacts.filter(
        (fact) => fact.category === 'experience',
      );
      const maxKeywordsInExperience = experienceFacts.reduce(
        (maximum, fact) =>
          Math.max(
            maximum,
            matchedKeywords.filter((keyword) =>
              this.includesKeyword(`${fact.detail}\n${fact.evidence}`, keyword),
            ).length,
          ),
        0,
      );
      const requiredYears = this.extractMaxYears(requirement.text);
      const requiredEducation = this.extractEducationLevel(requirement.text);
      const hasUnverifiedThreshold =
        (requiredYears > 0 &&
          this.extractMaxYears(resume.rawText) < requiredYears) ||
        (requiredEducation > 0 &&
          this.extractEducationLevel(resume.rawText) < requiredEducation);
      const hasStrongSpecificEvidence =
        specificMatchedKeywords.length > 0 &&
        keywordCoverage >= 0.6 &&
        (requirement.type !== 'responsibility' || experienceFacts.length > 0) &&
        !hasUnverifiedThreshold;
      const hasStrongGenericEvidence =
        specificMatchedKeywords.length === 0 &&
        matchedKeywords.length >= 2 &&
        keywordCoverage >= 0.75 &&
        maxKeywordsInExperience >= 2 &&
        !hasUnverifiedThreshold;
      const status: RequirementMapping['status'] =
        matchedKeywords.length === 0
          ? 'missing'
          : hasStrongSpecificEvidence || hasStrongGenericEvidence
            ? 'matched'
            : 'partial';

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

  private async buildRewrite(
    resume: ParsedResume,
    jd: ParsedJobDescription,
    mappings: RequirementMapping[],
    matchedKeywords: string[],
    factBase: CareerFactBase,
  ): Promise<ResumeCustomizeResponse['rewrite']> {
    const strongEvidence = mappings
      .filter((mapping) => mapping.status !== 'missing')
      .flatMap((mapping) => mapping.evidence)
      .filter(Boolean);
    const sourceBullets = this.unique(
      [...strongEvidence, ...resume.extracted.experienceBullets].map((line) =>
        this.stripBulletPrefix(line),
      ),
    ).filter((line) => this.isSafeRewriteCandidate(line));
    const keywordsForRewrite = matchedKeywords.slice(0, 6);
    const sourceFacts = this.pickSourceFactsForJob(
      factBase,
      jd,
      matchedKeywords,
    );
    const rewrittenExperienceBullets = sourceBullets
      .slice(0, 6)
      .map((bullet): RewriteSuggestion => {
        const evidenceBackedKeywords = keywordsForRewrite.filter((keyword) =>
          this.includesKeyword(bullet, keyword),
        );
        const after = this.buildSuggestedRewriteAfter(bullet);
        const sourceFactIds = this.findSourceFactIdsForText(factBase, bullet);
        const risk = this.assessRewriteRisk(
          bullet,
          after,
          sourceFactIds,
          undefined,
        );

        return {
          before: bullet,
          after,
          reason:
            evidenceBackedKeywords.length > 0
              ? `保留原始事实，并突出已有证据中的 ${evidenceBackedKeywords.join('、')}。`
              : '保留原始事实，仅做格式清理。',
          evidence: bullet,
          sourceFactIds,
          ...risk,
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

    const deterministicRewrite: ResumeCustomizeResponse['rewrite'] = {
      targetRole: jd.roleTitle,
      tailoredSummary,
      rewrittenExperienceBullets,
      skillsToEmphasize: matchedKeywords.slice(0, 10),
      sourceFacts,
      finalResumeMarkdown: this.buildFinalResumeMarkdown(
        resume,
        rewrittenExperienceBullets,
      ),
      modificationReasons,
    };

    return this.refineRewriteWithModel(
      deterministicRewrite,
      jd,
      matchedKeywords,
      sourceFacts,
      resume,
    );
  }

  private buildSuggestedRewriteAfter(bullet: string): string {
    return this.stripBulletPrefix(bullet).replace(/[。；;,.，、]+$/u, '');
  }

  private async refineRewriteWithModel(
    baseRewrite: ResumeCustomizeResponse['rewrite'],
    jd: ParsedJobDescription,
    matchedKeywords: string[],
    sourceFacts: SourceFactReference[],
    resume: ParsedResume,
  ): Promise<ResumeCustomizeResponse['rewrite']> {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey || baseRewrite.rewrittenExperienceBullets.length === 0) {
      return baseRewrite;
    }

    const modelOutput = await this.requestModelRewrite(
      apiKey,
      baseRewrite,
      jd,
      matchedKeywords,
      sourceFacts,
    ).catch(() => null);
    if (!modelOutput) {
      return baseRewrite;
    }

    const tailoredSummary =
      this.pickStringArray(modelOutput.tailoredSummary, 4) ??
      baseRewrite.tailoredSummary;
    const skillsToEmphasize = this.keepEvidenceBackedSkillOrder(
      this.pickStringArray(modelOutput.skillsToEmphasize, 10) ?? [],
      baseRewrite.skillsToEmphasize,
    );
    const modelBullets = modelOutput.rewrittenExperienceBullets ?? [];
    const modelBulletsByFactId = new Map(
      modelBullets.map((bullet) => [bullet.sourceFactId, bullet] as const),
    );
    const rewrittenExperienceBullets =
      baseRewrite.rewrittenExperienceBullets.map((suggestion) => {
        const modelBullet = suggestion.sourceFactIds
          .map((factId) => modelBulletsByFactId.get(factId))
          .find(Boolean);
        const groundedModelRewrite =
          modelBullet?.after &&
          !this.isNonEvidenceLine(modelBullet.after) &&
          this.isModelRewriteGrounded(
            suggestion.before,
            modelBullet.after,
            suggestion.sourceFactIds,
            sourceFacts,
          );
        const after =
          groundedModelRewrite && modelBullet
            ? modelBullet.after.trim()
            : suggestion.after;
        const risk = this.assessRewriteRisk(
          suggestion.before,
          after,
          suggestion.sourceFactIds,
          undefined,
        );

        return {
          ...suggestion,
          after,
          reason:
            groundedModelRewrite && modelBullet?.reason?.trim()
              ? modelBullet.reason.trim()
              : suggestion.reason,
          ...risk,
        } satisfies RewriteSuggestion;
      });
    const modificationReasons = this.unique([
      ...(this.pickStringArray(modelOutput.modificationReasons, 6) ?? []),
      ...baseRewrite.modificationReasons,
    ]).slice(0, 8);

    return {
      ...baseRewrite,
      tailoredSummary,
      rewrittenExperienceBullets,
      skillsToEmphasize,
      finalResumeMarkdown: this.buildFinalResumeMarkdown(
        resume,
        rewrittenExperienceBullets,
      ),
      modificationReasons,
    };
  }

  private async requestModelRewrite(
    apiKey: string,
    baseRewrite: ResumeCustomizeResponse['rewrite'],
    jd: ParsedJobDescription,
    matchedKeywords: string[],
    sourceFacts: SourceFactReference[],
  ): Promise<ModelRewriteOutput | null> {
    const baseUrl = (
      process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
    ).replace(/\/$/, '');
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是严谨的中文简历编辑。只改写逐条给出的经历事实，不编造或放大公司、角色、时间、学历、技能、指标、职责和项目结果。每条改写必须回传对应的 sourceFactId，不能重排事实。禁止输出“待补充”“建议”“可支撑目标岗位”等分析话术。输出必须是 JSON，不要 Markdown 代码块。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: '仅润色证据充分的经历 bullet；保留项目、组织、角色和事实边界，不生成整份简历。',
              outputSchema: {
                tailoredSummary: ['string'],
                rewrittenExperienceBullets: [
                  {
                    sourceFactId: 'string',
                    after: 'string',
                    reason: 'string',
                  },
                ],
                skillsToEmphasize: ['string'],
                modificationReasons: ['string'],
              },
              targetRole: jd.roleTitle,
              jobRequirements: jd.requirements.map((requirement) => ({
                id: requirement.id,
                text: requirement.text,
                type: requirement.type,
                keywords: requirement.keywords,
              })),
              matchedKeywords,
              allowedSkills: baseRewrite.skillsToEmphasize,
              sourceFacts,
              currentRewrite: {
                tailoredSummary: baseRewrite.tailoredSummary,
                rewrittenExperienceBullets:
                  baseRewrite.rewrittenExperienceBullets.map((suggestion) => ({
                    before: suggestion.before,
                    after: suggestion.after,
                    sourceFactIds: suggestion.sourceFactIds,
                    riskLevel: suggestion.riskLevel,
                  })),
                skillsToEmphasize: baseRewrite.skillsToEmphasize,
              },
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as DeepSeekChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    return this.parseModelRewriteOutput(content);
  }

  private parseModelRewriteOutput(content: string): ModelRewriteOutput | null {
    try {
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as unknown;
      if (!this.isRecord(parsed)) {
        return null;
      }

      return {
        tailoredSummary: this.pickStringArray(parsed.tailoredSummary, 4),
        rewrittenExperienceBullets: this.pickModelRewriteBullets(
          parsed.rewrittenExperienceBullets,
        ),
        skillsToEmphasize: this.pickStringArray(parsed.skillsToEmphasize, 10),
        modificationReasons: this.pickStringArray(
          parsed.modificationReasons,
          8,
        ),
      };
    } catch {
      return null;
    }
  }

  private pickModelRewriteBullets(value: unknown): ModelRewriteBullet[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item): ModelRewriteBullet | null => {
        if (
          !this.isRecord(item) ||
          typeof item.sourceFactId !== 'string' ||
          typeof item.after !== 'string'
        ) {
          return null;
        }

        const sourceFactId = item.sourceFactId.trim();
        const after = item.after.trim();
        if (!sourceFactId || !after) {
          return null;
        }

        return {
          sourceFactId,
          after,
          reason:
            typeof item.reason === 'string' ? item.reason.trim() : undefined,
        };
      })
      .filter((item): item is ModelRewriteBullet => Boolean(item))
      .slice(0, 6);
  }

  private pickStringArray(value: unknown, limit: number): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const strings = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit);

    return strings.length > 0 ? strings : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private keepEvidenceBackedSkillOrder(
    modelSkills: string[],
    allowedSkills: string[],
  ): string[] {
    const allowedByToken = new Map(
      allowedSkills.map((skill) => [
        this.normalizeComparisonToken(skill),
        skill,
      ]),
    );
    const orderedModelSkills = modelSkills
      .map((skill) => allowedByToken.get(this.normalizeComparisonToken(skill)))
      .filter((skill): skill is string => Boolean(skill));

    return this.unique([...orderedModelSkills, ...allowedSkills]).slice(0, 10);
  }

  private isModelRewriteGrounded(
    before: string,
    after: string,
    sourceFactIds: string[],
    sourceFacts: SourceFactReference[],
  ): boolean {
    const linkedFacts = sourceFacts.filter((fact) =>
      sourceFactIds.includes(fact.id),
    );
    if (linkedFacts.length === 0) {
      return false;
    }

    if (/待补充|建议|可支撑|目标岗位|生成边界|人工审核/i.test(after)) {
      return false;
    }

    const evidenceText = [
      before,
      ...linkedFacts.flatMap((fact) => [fact.detail, fact.evidence]),
    ].join('\n');
    const evidenceMetrics = new Set(evidenceText.match(METRIC_PATTERN) ?? []);
    const hasNewMetric = (after.match(METRIC_PATTERN) ?? []).some(
      (metric) => !evidenceMetrics.has(metric),
    );
    if (hasNewMetric) {
      return false;
    }

    const allowedKeywords = new Set(
      this.extractKeywords(evidenceText).map((keyword) =>
        this.normalizeComparisonToken(keyword),
      ),
    );
    const hasUnsupportedKeyword = this.extractKeywords(after).some(
      (keyword) => !allowedKeywords.has(this.normalizeComparisonToken(keyword)),
    );
    if (hasUnsupportedKeyword) {
      return false;
    }

    const unsupportedClaim = after.match(UNSUPPORTED_CLAIM_PATTERN)?.[0];
    if (
      unsupportedClaim &&
      !this.includesKeyword(evidenceText, unsupportedClaim)
    ) {
      return false;
    }

    return this.characterBigramCoverage(evidenceText, after) >= 0.2;
  }

  private characterBigramCoverage(source: string, candidate: string): number {
    const toBigrams = (value: string): Set<string> => {
      const normalized = this.normalizeComparisonToken(value);
      const bigrams = new Set<string>();
      for (let index = 0; index < normalized.length - 1; index += 1) {
        bigrams.add(normalized.slice(index, index + 2));
      }
      return bigrams;
    };
    const sourceBigrams = toBigrams(source);
    const candidateBigrams = toBigrams(candidate);
    if (candidateBigrams.size === 0) {
      return 0;
    }

    const matched = Array.from(candidateBigrams).filter((bigram) =>
      sourceBigrams.has(bigram),
    ).length;
    return matched / candidateBigrams.size;
  }

  private assessRewriteRisk(
    before: string,
    after: string,
    sourceFactIds: string[],
    insertedKeyword: string | undefined,
  ): Pick<
    RewriteSuggestion,
    'riskLevel' | 'riskReasons' | 'acceptedByDefault'
  > {
    const riskReasons: string[] = [];
    const beforeMetrics = new Set(before.match(METRIC_PATTERN) ?? []);
    const newMetrics = (after.match(METRIC_PATTERN) ?? []).filter(
      (metric) => !beforeMetrics.has(metric),
    );

    if (sourceFactIds.length === 0) {
      riskReasons.push('未找到可回溯的职业事实来源。');
    }

    if (newMetrics.length > 0) {
      riskReasons.push(
        `改写中出现原句未包含的数字：${newMetrics.join('、')}。`,
      );
    }

    if (insertedKeyword && !this.includesKeyword(before, insertedKeyword)) {
      riskReasons.push(
        `新增关键词「${insertedKeyword}」来自其他事实或技能区，需人工确认语境是否成立。`,
      );
    }

    const riskLevel: RewriteSuggestion['riskLevel'] =
      sourceFactIds.length === 0 || newMetrics.length > 0
        ? 'high'
        : riskReasons.length > 0
          ? 'medium'
          : 'low';

    return {
      riskLevel,
      riskReasons:
        riskReasons.length > 0
          ? riskReasons
          : ['低风险：改写未新增数字，且能追溯到原始职业事实。'],
      acceptedByDefault: riskLevel !== 'high',
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

  private pickSourceFactsForJob(
    factBase: CareerFactBase,
    jd: ParsedJobDescription,
    matchedKeywords: string[],
  ): SourceFactReference[] {
    const keywords = this.unique([
      ...matchedKeywords,
      ...jd.criticalKeywords,
      ...jd.keywords.slice(0, 6),
    ]);
    const scoredFacts = factBase.facts
      .map((fact) => {
        const haystack = `${fact.title}\n${fact.detail}\n${fact.evidence}`;
        const keywordHits = keywords.filter((keyword) =>
          this.includesKeyword(haystack, keyword),
        ).length;
        const categoryBoost =
          fact.category === 'experience'
            ? 2
            : fact.category === 'metric' || fact.category === 'skill'
              ? 1
              : 0;

        return {
          fact,
          score: keywordHits * 3 + categoryBoost,
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const candidates =
      scoredFacts.length > 0
        ? scoredFacts.map((item) => item.fact)
        : factBase.facts.filter((fact) => fact.category === 'experience');

    return candidates
      .slice(0, 8)
      .map((fact) => this.toSourceFactReference(fact));
  }

  private findSourceFactIdsForText(
    factBase: CareerFactBase,
    text: string,
  ): string[] {
    const normalizedText = this.stripBulletPrefix(text).toLowerCase();
    const keywords = this.extractKeywords(text);
    const directMatches = factBase.facts.filter((fact) => {
      const detail = fact.detail.toLowerCase();
      const evidence = fact.evidence.toLowerCase();

      return (
        normalizedText.includes(detail) ||
        detail.includes(normalizedText) ||
        normalizedText.includes(evidence) ||
        evidence.includes(normalizedText)
      );
    });

    if (directMatches.length > 0) {
      return directMatches.slice(0, 3).map((fact) => fact.id);
    }

    return factBase.facts
      .filter((fact) =>
        keywords.some((keyword) =>
          this.includesKeyword(`${fact.detail}\n${fact.evidence}`, keyword),
        ),
      )
      .slice(0, 3)
      .map((fact) => fact.id);
  }

  private toSourceFactReference(fact: CareerFact): SourceFactReference {
    return {
      id: fact.id,
      category: fact.category,
      detail: fact.detail,
      evidence: fact.evidence,
      confidence: fact.confidence,
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

  private includesKeyword(text: string, keyword: string): boolean {
    const normalizedKeyword = this.normalizeText(keyword);
    if (!normalizedKeyword) {
      return false;
    }

    if (/^[A-Za-z][A-Za-z0-9+/#.-]{0,16}$/.test(normalizedKeyword)) {
      const escapedKeyword = this.escapeRegExp(normalizedKeyword);
      return new RegExp(
        `(^|[^A-Za-z0-9])${escapedKeyword}([^A-Za-z0-9]|$)`,
        'i',
      ).test(text);
    }

    return text.toLowerCase().includes(normalizedKeyword.toLowerCase());
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toLines(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private toRequirementCandidates(text: string): JobRequirementCandidate[] {
    const candidates: JobRequirementCandidate[] = [];
    let activeType: JobRequirement['type'] | undefined;

    for (const sourceLine of this.toLines(text)) {
      if (this.isJobSectionBoundary(sourceLine)) {
        activeType = undefined;
        continue;
      }

      const section = this.extractJobSection(sourceLine);
      if (section) {
        activeType = section.type;
        if (!section.content) {
          continue;
        }
      }

      const content = section?.content ?? sourceLine;
      for (const fragment of this.splitRequirementFragments(content)) {
        const cleanLine = this.stripBulletPrefix(fragment);

        if (!this.isJobRequirementCandidate(cleanLine, Boolean(activeType))) {
          continue;
        }

        candidates.push({
          text: cleanLine,
          typeHint: activeType,
        });
      }
    }

    return candidates.filter((candidate, index, all) => {
      const normalized = this.normalizeComparisonToken(candidate.text);
      return (
        normalized.length > 0 &&
        all.findIndex(
          (item) => this.normalizeComparisonToken(item.text) === normalized,
        ) === index
      );
    });
  }

  private extractJobSection(
    line: string,
  ): { type: JobRequirement['type']; content: string } | null {
    const match = line.match(
      /^(?<heading>岗位职责|职位职责|工作职责|主要职责|职责描述|任职要求|职位要求|岗位要求|基本要求|任职资格|职位资格|申请条件|最低要求|加分项|优先条件|优先资格|responsibilities?|what you(?:'|’)ll do|what you will do|your impact|requirements?|qualifications?|minimum qualifications?|what we(?:'|’)re looking for|who you are|you have|preferred qualifications?|nice to have)\s*(?:[:：]|[-—–]\s*)?(?<content>.*)$/i,
    );
    const heading = match?.groups?.heading?.trim();
    if (!heading) {
      return null;
    }

    const type: JobRequirement['type'] =
      /加分|优先|preferred|nice to have/i.test(heading)
        ? 'preferred'
        : /职责|responsib|what you(?:'|’)ll do|what you will do|your impact/i.test(
              heading,
            )
          ? 'responsibility'
          : 'required';

    return {
      type,
      content: match?.groups?.content?.trim() ?? '',
    };
  }

  private splitRequirementFragments(line: string): string[] {
    return line
      .replace(/\s+(?=(?:\d+[).、]|[（(]\d+[）)])\s*)/g, '\n')
      .split(/\n|(?<=[。；;])\s*/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);
  }

  private isJobSectionBoundary(line: string): boolean {
    return (
      JD_NOISE_PATTERN.test(line) ||
      JD_SECTION_BOUNDARY_PATTERN.test(line) ||
      /^(?:福利待遇|薪资福利|我们提供|公司介绍|团队介绍|为什么加入我们|工作地点|申请方式|招聘流程|其他信息|benefits?|our benefits|employee benefits|what we offer|why (?:join us|binance)|working at binance|about (?:us|binance|the company|the team)|compensation|location|how to apply|equal opportunity)\s*[:：]/i.test(
        line,
      )
    );
  }

  private isJobRequirementCandidate(
    line: string,
    insideRequirementSection: boolean,
  ): boolean {
    if (line.length < 8 || line.length > 500) {
      return false;
    }

    if (
      JD_NOISE_PATTERN.test(line) ||
      this.isJobSectionBoundary(line) ||
      /^(?:岗位|职位|招聘|公司|企业|雇主|department|team|company|job title)\s*[:：]/i.test(
        line,
      )
    ) {
      return false;
    }

    return insideRequirementSection || JD_REQUIREMENT_SIGNAL_PATTERN.test(line);
  }

  private detectRequirementType(
    text: string,
    typeHint?: JobRequirement['type'],
  ): JobRequirement['type'] {
    if (/优先|加分|preferred|plus/i.test(text)) {
      return 'preferred';
    }

    if (/要求|必须|熟悉|掌握|具备|经验|required|must/i.test(text)) {
      return 'required';
    }

    if (typeHint) {
      return typeHint;
    }

    if (/负责|职责|推动|设计|搭建|实现|responsib/i.test(text)) {
      return 'responsibility';
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

    return this.cleanRoleTitle(
      titleMatch?.groups?.title?.trim() || firstLine.slice(0, 40),
    );
  }

  private cleanRoleTitle(value: string): string {
    const cleaned = this.normalizeText(value)
      .replace(/^(岗位|职位|招聘)[:：\s]*/i, '')
      .replace(/(?:\s*[-—–|｜:：]+\s*)+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return cleaned || '目标岗位';
  }

  private extractResumeBullets(lines: string[]): string[] {
    const candidates = this.unique(
      lines
        .map((line) => this.stripBulletPrefix(line))
        .filter((line) => this.isSafeRewriteCandidate(line)),
    );
    const normalizedCandidates = candidates.map((line) =>
      this.normalizeResumeLineForComparison(line),
    );

    return candidates
      .filter(
        (_, index) =>
          !this.isContainedExperienceDuplicate(
            normalizedCandidates[index] ?? '',
            index,
            normalizedCandidates,
          ),
      )
      .slice(0, 12);
  }

  private isSafeRewriteCandidate(line: string): boolean {
    const candidate = this.stripBulletPrefix(line);
    if (this.isNonEvidenceLine(candidate) || candidate.length < 16) {
      return false;
    }

    const hasAction = EXPERIENCE_ACTION_PATTERN.test(candidate);
    const hasMetric = (candidate.match(METRIC_PATTERN) ?? []).length > 0;
    const hasContext = EXPERIENCE_CONTEXT_PATTERN.test(candidate);

    return hasAction && (hasContext || hasMetric || candidate.length >= 24);
  }

  private isNonEvidenceLine(line: string): boolean {
    const candidate = this.stripBulletPrefix(line);
    if (!candidate || candidate.length < 4) {
      return true;
    }

    if (SECTION_MATCHERS.some((matcher) => matcher.pattern.test(candidate))) {
      return true;
    }

    if (
      CONTACT_LINE_PATTERN.test(candidate) ||
      PROFILE_HEADING_PATTERN.test(candidate)
    ) {
      return true;
    }

    if (
      ROLE_ONLY_LINE_PATTERN.test(candidate) &&
      !EXPERIENCE_ACTION_PATTERN.test(candidate)
    ) {
      return true;
    }

    return false;
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
    const known = KNOWN_KEYWORDS.filter((keyword) =>
      this.includesKeyword(text, keyword),
    );
    const acronyms = (text.match(/\b[A-Z][A-Z0-9+/#.-]{1,12}\b/g) ?? []).filter(
      (keyword) => !KEYWORD_STOPWORDS.has(keyword.toUpperCase()),
    );
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
    const experienceEvidence = resume.extracted.experienceBullets.find((line) =>
      this.isSafeRewriteCandidate(line),
    );

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
    resume: ParsedResume,
    rewrittenExperienceBullets: RewriteSuggestion[],
  ): string {
    const replacements = new Map(
      rewrittenExperienceBullets
        .filter(
          (suggestion) =>
            suggestion.acceptedByDefault &&
            suggestion.riskLevel === 'low' &&
            suggestion.after.trim().length > 0,
        )
        .map((suggestion) => [
          this.normalizeResumeLineForComparison(suggestion.before),
          suggestion.after.trim(),
        ]),
    );
    const rawLines = resume.rawText.split('\n');
    const experienceComparisonKeys = new Set(
      resume.sections.experience
        .map((line) => this.stripBulletPrefix(line))
        .filter((line) => line.length >= 16 && !this.isNonEvidenceLine(line))
        .map((line) => this.normalizeResumeLineForComparison(line)),
    );
    const normalizedExperienceLines = rawLines.map((line) => {
      const cleanLine = this.stripBulletPrefix(line.trim());
      const comparisonKey = this.normalizeResumeLineForComparison(cleanLine);
      return experienceComparisonKeys.has(comparisonKey) ||
        (experienceComparisonKeys.size === 0 &&
          this.isSafeRewriteCandidate(cleanLine))
        ? comparisonKey
        : '';
    });
    const usedReplacements = new Set<string>();
    const finalLines = rawLines.flatMap((line, index) => {
      const comparisonKey = normalizedExperienceLines[index] ?? '';
      if (
        comparisonKey &&
        this.isContainedExperienceDuplicate(
          comparisonKey,
          index,
          normalizedExperienceLines,
        )
      ) {
        return [];
      }

      const replacement = replacements.get(comparisonKey);
      if (!replacement || usedReplacements.has(comparisonKey)) {
        return [line];
      }

      usedReplacements.add(comparisonKey);
      const prefix =
        line.match(/^\s*(?:(?:[-*•·]|\d+[).、]|[（(]?\d+[）)])\s*)/u)?.[0] ??
        '';
      return [`${prefix}${replacement}`];
    });

    return `${this.normalizeText(finalLines.join('\n'))}\n`;
  }

  private normalizeResumeLineForComparison(value: string): string {
    return this.stripBulletPrefix(value)
      .replace(/[\s。；;,.，、]+/gu, '')
      .toLowerCase();
  }

  private isContainedExperienceDuplicate(
    candidate: string,
    candidateIndex: number,
    allCandidates: string[],
  ): boolean {
    if (candidate.length < 20) {
      return false;
    }

    return allCandidates.some((other, otherIndex) => {
      if (
        !other ||
        otherIndex === candidateIndex ||
        other.length < candidate.length
      ) {
        return false;
      }

      if (other === candidate) {
        return otherIndex < candidateIndex;
      }

      return (
        other.includes(candidate) && candidate.length / other.length >= 0.6
      );
    });
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
