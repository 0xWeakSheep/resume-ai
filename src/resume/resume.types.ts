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
    finalResumeMarkdown: string;
    modificationReasons: string[];
  };
  quality: QualityReport;
}
