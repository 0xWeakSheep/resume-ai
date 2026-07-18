export type ResumeFileKind = 'pdf' | 'docx' | 'text';

export interface UploadedResumeFile {
  name: string;
  mimeType?: string;
  dataBase64: string;
}

export interface ResumeCustomizeRequest {
  resume?: {
    text?: string;
    file?: UploadedResumeFile;
  };
  jobDescription?: string;
  answers?: string;
}

export interface ResumeFactRequest {
  resume?: {
    text?: string;
    file?: UploadedResumeFile;
  };
  answers?: string;
}

export interface ParsedResume {
  sourceType: ResumeFileKind | 'plain-text';
  rawText: string;
  sections: {
    summary: string[];
    experience: string[];
    education: string[];
    skills: string[];
    other: string[];
  };
  extracted: {
    skills: string[];
    education: string[];
    experienceBullets: string[];
    keywords: string[];
  };
  warnings: string[];
}

export type CareerFactCategory =
  'profile' | 'experience' | 'education' | 'skill' | 'metric' | 'keyword';

export interface CareerFact {
  id: string;
  category: CareerFactCategory;
  title: string;
  detail: string;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CareerFactBase {
  sourceType: ParsedResume['sourceType'];
  totalFacts: number;
  facts: CareerFact[];
  grouped: Record<CareerFactCategory, CareerFact[]>;
  warnings: string[];
}

export interface ResumeFactResponse {
  parsedResume: ParsedResume;
  factBase: CareerFactBase;
}

export interface JobInputSource {
  type: 'text' | 'url';
  value: string;
}

export interface JobStandardizeRequest {
  resume?: {
    text?: string;
    file?: UploadedResumeFile;
  };
  answers?: string;
  jobDescription?: string;
  jobDescriptions?: string[];
  jobUrls?: string[];
  sources?: JobInputSource[];
}

export interface HardRequirement {
  type:
    'education' | 'experience' | 'location' | 'language' | 'skill' | 'other';
  text: string;
}

export interface HardRequirementMatch {
  type: HardRequirement['type'];
  text: string;
  status: 'matched' | 'partial' | 'missing';
  evidence: string[];
}

export interface JobMatchReport {
  score: number;
  level: 'high' | 'medium' | 'low' | 'unmatched';
  matchedKeywords: string[];
  missingKeywords: string[];
  hardRequirementResults: HardRequirementMatch[];
  blockedByHardRequirements: boolean;
  reasons: string[];
}

export interface StandardizedJob {
  id: string;
  sourceType: JobInputSource['type'];
  source: string;
  status: 'ready' | 'failed' | 'duplicate';
  roleTitle: string;
  company?: string;
  rawText: string;
  normalizedText: string;
  requirements: JobRequirement[];
  keywords: string[];
  criticalKeywords: string[];
  hardRequirements: HardRequirement[];
  similarityGroupId?: string;
  duplicateOf?: string;
  filterStatus?: 'pass' | 'review' | 'blocked';
  priorityRank?: number;
  match?: JobMatchReport;
  warnings: string[];
}

export interface JobStandardizeResponse {
  jobs: StandardizedJob[];
  summary: {
    total: number;
    ready: number;
    failed: number;
    duplicate: number;
    ranked: number;
    blocked: number;
  };
}

export interface ParsedJobDescription {
  rawText: string;
  roleTitle: string;
  requirements: JobRequirement[];
  keywords: string[];
  criticalKeywords: string[];
}

export interface JobRequirement {
  id: string;
  text: string;
  type: 'responsibility' | 'required' | 'preferred' | 'other';
  keywords: string[];
}

export interface RequirementMapping {
  requirementId: string;
  requirement: string;
  status: 'matched' | 'partial' | 'missing';
  matchedKeywords: string[];
  evidence: string[];
  recommendation: string;
}

export interface RewriteSuggestion {
  before: string;
  after: string;
  reason: string;
  evidence: string;
  sourceFactIds: string[];
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
  acceptedByDefault: boolean;
}

export interface SourceFactReference {
  id: string;
  category: CareerFactCategory;
  detail: string;
  evidence: string;
  confidence: CareerFact['confidence'];
}

export interface QualityReport {
  keywordCoverage: {
    matched: number;
    total: number;
    ratio: number;
    matchedKeywords: string[];
    missingKeywords: string[];
  };
  factConsistency: {
    riskLevel: 'low' | 'medium' | 'high';
    issues: string[];
  };
  readability: {
    averageBulletLength: number;
    longBulletCount: number;
    score: number;
  };
  formatChecks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
  manualReviewChecklist: string[];
}

export interface ResumeCustomizeResponse {
  parsedResume: ParsedResume;
  parsedJobDescription: ParsedJobDescription;
  analysis: {
    requirementMappings: RequirementMapping[];
    matchedKeywords: string[];
    missingKeywords: string[];
    followUpQuestions: string[];
  };
  rewrite: {
    targetRole: string;
    tailoredSummary: string[];
    rewrittenExperienceBullets: RewriteSuggestion[];
    skillsToEmphasize: string[];
    sourceFacts: SourceFactReference[];
    finalResumeMarkdown: string;
    modificationReasons: string[];
  };
  quality: QualityReport;
}
