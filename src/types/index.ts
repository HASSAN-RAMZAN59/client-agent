// ==============================================================================
// DOMAIN TYPES & PROVIDER INTERFACES (PHASE 4 EXPANDED)
// ==============================================================================

export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type AuditStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'NO_WEBSITE';

export type LeadStatus =
  | 'NEW'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'CONTACTED'
  | 'RESPONDED'
  | 'CLOSED';

export type OutreachChannel = 'EMAIL' | 'LINKEDIN' | 'CONTACT_FORM';

export type OutreachStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

export type FollowUpStatus = 'PENDING' | 'SENT' | 'CANCELLED' | 'SKIPPED';

export type ReplyClassification =
  | 'POSITIVE_INTEREST'
  | 'MORE_INFO_REQUESTED'
  | 'NOT_INTERESTED'
  | 'WRONG_PERSON'
  | 'BOUNCE'
  | 'AUTO_REPLY'
  | 'UNCLASSIFIED';

// Phase 2.5 Discovery Safety & Classification Types
export type SourceStatus =
  | 'AVAILABLE'
  | 'BLOCKED'
  | 'RATE_LIMITED'
  | 'DISABLED'
  | 'ERROR';

export type WebsiteReachabilityStatus =
  | 'WEBSITE_FOUND'
  | 'WEBSITE_REACHABLE'
  | 'WEBSITE_UNREACHABLE'
  | 'WEBSITE_TIMEOUT'
  | 'WEBSITE_BLOCKED'
  | 'NO_WEBSITE_FOUND'
  | 'UNKNOWN';

export type OfficialWebsiteConfidence =
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'UNKNOWN';

// Phase 3 Website Intelligence & Audit Types
export type DetailedAuditStatus =
  | 'AUDITED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'NO_WEBSITE'
  | 'ERROR';

export type AuditConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type OpportunityFlag =
  | 'NO_WEBSITE'
  | 'POOR_MOBILE'
  | 'SLOW_LOADING'
  | 'NO_CLEAR_CTA'
  | 'NO_CONTACT_METHOD'
  | 'NO_BOOKING'
  | 'WEAK_SEO'
  | 'ACCESSIBILITY_ISSUES'
  | 'OUTDATED_SIGNALS'
  | 'BROKEN_ELEMENTS'
  | 'THIN_CONTENT';

export type MobileAppOpportunityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AuditFinding {
  category: 'technical' | 'mobile' | 'performance' | 'seo' | 'accessibility' | 'ux' | 'content';
  title: string;
  description: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  evidence: string;
}

export interface AuditCategoryScores {
  technical: number;
  mobile: number;
  performance: number;
  seo: number;
  accessibility: number;
  ux: number;
  content: number;
}

export interface ComprehensiveAuditResult {
  website: string;
  finalUrl?: string;
  status: DetailedAuditStatus;
  confidence: AuditConfidence;
  overallScore: number;
  categories: AuditCategoryScores;
  opportunityFlags: OpportunityFlag[];
  mobileAppOpportunity: MobileAppOpportunityLevel;
  mobileAppReasoning: string[];
  findings: AuditFinding[];
  topProblems: string[];
  pageCount: number;
  mobileResponsive: boolean;
  sslValid: boolean;
  hasContactForm: boolean;
  loadTimeMs: number;
  issues: string[];
  auditedAt: Date;
}

// ------------------------------------------------------------------------------
// Phase 4 Multi-Factor Lead Scoring & Prioritization Types
// ------------------------------------------------------------------------------

export type LeadClassification = 'HOT' | 'WARM' | 'COLD' | 'DISQUALIFIED';

export type RecommendedService =
  | 'WEBSITE_REBUILD'
  | 'WEBSITE_IMPROVEMENT'
  | 'MOBILE_OPTIMIZATION'
  | 'MOBILE_APP'
  | 'SEO_IMPROVEMENT'
  | 'MAINTENANCE'
  | 'NO_CLEAR_SERVICE_FIT';

export interface SalesAngle {
  problem: string;
  opportunity: string;
  recommendedService: RecommendedService;
  reason: string;
}

export interface MultiFactorScoreBreakdown {
  websiteOpportunity: number;    // 30% weight
  commercialPotential: number;   // 20% weight
  contactability: number;        // 15% weight
  websiteProblem: number;        // 15% weight
  mobileAppOpportunity: number;  // 10% weight
  dataConfidence: number;        // 10% weight
}

export interface ComprehensiveLeadScore {
  leadOpportunityScore: number; // 0 - 100
  overallScore: number;         // Mirror of leadOpportunityScore
  classification: LeadClassification;
  priority: PriorityLevel;
  priorityRank: number;         // 1 (Highest: HOT + HIGH conf) to 5 (Lowest: COLD)
  confidenceLevel: AuditConfidence;
  breakdown: MultiFactorScoreBreakdown;
  recommendedService: RecommendedService;
  topOpportunitySignals: OpportunityFlag[];
  topProblems: string[];
  salesAngle: SalesAngle;
  reasoning: string[];
}

export interface LeadScoreResult extends ComprehensiveLeadScore {
  websiteOpportunityScore: number;
  mobileAppOpportunityScore: number;
  qualificationStatus: 'QUALIFIED' | 'DISQUALIFIED';
}

// ------------------------------------------------------------------------------
// Input DTOs with Provenance
// ------------------------------------------------------------------------------

export interface DiscoveredBusinessInput {
  name: string;
  category: string;
  city: string;
  country?: string;
  address?: string;
  phone?: string;
  website?: string;
  source: string;
  sourceUrl?: string;
  websiteSource?: string;
  phoneSource?: string;
  addressSource?: string;
  officialWebsiteConfidence?: OfficialWebsiteConfidence;
  discoveredAt?: Date;
}

export interface WebsiteAuditResult {
  website: string;
  status: AuditStatus;
  score: number;
  performanceScore?: number;
  mobileResponsive?: boolean;
  sslValid?: boolean;
  hasContactForm?: boolean;
  loadTimeMs?: number;
  issues: string[];
}

// ------------------------------------------------------------------------------
// Phase 5 Public Business Contact Discovery Types
// ------------------------------------------------------------------------------

export type ContactType = 'EMAIL' | 'PHONE' | 'CONTACT_FORM';

export type ContactClassification =
  | 'BUSINESS_GENERIC'
  | 'BUSINESS_DEPARTMENT'
  | 'BUSINESS_NAMED'
  | 'UNKNOWN';

export type ContactSourceType =
  | 'OFFICIAL_WEBSITE'
  | 'PUBLIC_LISTING'
  | 'PUBLIC_SEARCH'
  | 'OTHER_PUBLIC_SOURCE';

export type ContactDiscoveryStatus =
  | 'VERIFIED_PUBLIC'
  | 'PUBLIC_UNVERIFIED'
  | 'NONE_FOUND'
  | 'INVALID'
  | 'BLOCKED';

export interface DiscoveredContactRecord {
  value: string;
  type: ContactType;
  classification: ContactClassification;
  email?: string;
  contactName?: string;
  role?: string;
  rawPhone?: string;
  normalizedPhone?: string;
  source: string;
  sourceUrl?: string;
  sourceType: ContactSourceType;
  confidence: AuditConfidence;
  qualityScore: number;
  status: ContactDiscoveryStatus;
  discoveredAt: Date;
}

export interface ContactDiscoveryResult {
  businessId: string;
  businessName: string;
  website?: string;
  contacts: DiscoveredContactRecord[];
  primaryContact?: DiscoveredContactRecord;
  status: ContactDiscoveryStatus;
  pagesVisited: string[];
  contactQualityScore: number;
}

export interface DiscoveredContactInput {
  email?: string;
  value?: string;
  type?: ContactType;
  classification?: ContactClassification;
  contactName?: string;
  role?: string;
  rawPhone?: string;
  normalizedPhone?: string;
  source: string;
  sourceUrl?: string;
  sourceType?: ContactSourceType;
  confidence?: AuditConfidence;
  qualityScore?: number;
  status?: ContactDiscoveryStatus;
  isVerified?: boolean;
  isPublic?: boolean;
}

export interface DraftOutreachInput {
  leadId: string;
  channel: OutreachChannel;
  subject?: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
  status: 'SENT' | 'SIMULATED' | 'FAILED';
  recipient: string;
  sentAt: Date;
  details?: string;
}

// ------------------------------------------------------------------------------
// Core Provider Interfaces
// ------------------------------------------------------------------------------

export interface BusinessDiscoveryQuery {
  niche: string;
  city: string;
  country?: string;
  limit?: number;
}

export interface BusinessDiscoveryProvider {
  readonly providerName: string;
  discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]>;
}

export interface WebsiteAuditProvider {
  readonly providerName: string;
  audit(websiteUrl: string, businessName?: string, category?: string): Promise<ComprehensiveAuditResult>;
}

export interface LeadScoringProvider {
  readonly providerName: string;
  calculateScore(params: {
    business: {
      name: string;
      category: string;
      city?: string;
      address?: string | null;
      phone?: string | null;
      website?: string | null;
      source?: string;
      officialWebsiteConfidence?: OfficialWebsiteConfidence;
    };
    audit?: ComprehensiveAuditResult | WebsiteAuditResult | null;
    contacts?: DiscoveredContactInput[];
    hasWebsite?: boolean;
    category?: string;
  }): LeadScoreResult;
}

// ------------------------------------------------------------------------------
// Phase 6 AI Personalization & Outreach Content Types
// ------------------------------------------------------------------------------

export type OutreachVariant =
  | 'VARIANT_A_SHORT'
  | 'VARIANT_B_STANDARD'
  | 'VARIANT_C_AUDIT';

export type DraftStatus =
  | 'DRAFT'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT';

export interface DetailedSalesAngle {
  problem: string;
  evidence: string[];
  opportunity: string;
  recommendedService: RecommendedService;
  businessImpact: string;
  confidence: AuditConfidence;
}

export interface PersonalizationContext {
  business: {
    name: string;
    category: string;
    city: string;
    country?: string;
    address?: string | null;
    phone?: string | null;
    website?: string | null;
    reachabilityStatus?: string;
    confidence?: string;
  };
  audit: {
    websiteStatus: string;
    overallScore: number;
    loadTimeMs?: number;
    mobileResponsive?: boolean;
    sslValid?: boolean;
    hasContactForm?: boolean;
    findings: AuditFinding[];
    opportunityFlags: OpportunityFlag[];
    topProblems: string[];
    mobileAppOpportunity?: string;
    mobileAppReasoning?: string[];
  } | null;
  lead: {
    id: string;
    leadOpportunityScore: number;
    classification: LeadClassification;
    priority: PriorityLevel;
    priorityRank: number;
    confidenceLevel: AuditConfidence;
    recommendedService: RecommendedService;
    salesAngle?: SalesAngle | null;
    topOpportunitySignals: OpportunityFlag[];
    topProblems: string[];
  };
  contact: {
    value?: string | null;
    type: ContactType | 'NONE';
    classification: ContactClassification;
    qualityScore: number;
    contactName?: string | null;
    role?: string | null;
    status: ContactDiscoveryStatus;
    sourceUrl?: string | null;
    sourceType?: ContactSourceType | null;
  };
  sender: {
    name: string;
    company: string;
    email: string;
  };
}

export interface OutreachQualityCheck {
  passed: boolean;
  score: number;
  warnings: string[];
  blockedReasons: string[];
}

export interface OutreachDraftResult {
  variant: OutreachVariant;
  channel: OutreachChannel;
  subject: string;
  subjectVariants: string[];
  body: string;
  personalizationScore: number;
  confidence: AuditConfidence;
  provider: string;
  sourceEvidence: string[];
  salesAngle: DetailedSalesAngle;
  qualityCheck: OutreachQualityCheck;
  status: DraftStatus;
}

export interface PersonalizationResult {
  leadId: string;
  businessName: string;
  salesAngle: DetailedSalesAngle;
  variants: OutreachDraftResult[];
  overallPersonalizationScore: number;
  primaryContactValue?: string;
  primaryContactType?: string;
}

export interface PersonalizationProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generate(context: PersonalizationContext): Promise<PersonalizationResult>;
}

// ------------------------------------------------------------------------------
// Phase 6.5 Outreach Hardening, Quality Bands & Gate Types
// ------------------------------------------------------------------------------

export type QualityBand =
  | 'EXCELLENT'
  | 'GOOD'
  | 'REVIEW_REQUIRED'
  | 'REJECTED';

export type SuppressionReason =
  | 'USER_REQUESTED'
  | 'UNSUBSCRIBED'
  | 'DO_NOT_CONTACT'
  | 'PREVIOUS_BOUNCE'
  | 'INVALID_CONTACT'
  | 'MANUAL_BLOCK'
  | 'COMPLIANCE_REVIEW';

export type SuppressionTargetType =
  | 'EMAIL'
  | 'DOMAIN'
  | 'PHONE'
  | 'BUSINESS';

export type OutreachLifecycleStatus =
  | 'DRAFT'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'READY_TO_SEND'
  | 'REJECTED'
  | 'SUPPRESSED'
  | 'STALE'
  | 'INVALID'
  | 'EXPIRED'
  | 'SENT'
  | 'FAILED';

export interface GateEvaluationResult {
  allowed: boolean;
  status: OutreachLifecycleStatus;
  score: number;
  qualityBand: QualityBand;
  reasons: string[];
  warnings: string[];
  evidenceValid: boolean;
  identityValid: boolean;
  isSuppressed: boolean;
  isDuplicate: boolean;
  isStale: boolean;
  isApproved: boolean;
}

export interface SuppressionEntry {
  id: string;
  businessId?: string | null;
  targetValue: string;
  targetType: SuppressionTargetType;
  reason: SuppressionReason;
  notes?: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// ------------------------------------------------------------------------------
// Phase 7 Outreach Execution & Delivery Provider Types
// ------------------------------------------------------------------------------

export interface DeliveryParams {
  outreachId: string;
  leadId: string;
  businessId: string;
  businessName: string;
  recipient: string;
  recipientType: string;
  subject: string;
  body: string;
  dryRun: boolean;
}

export interface DeliveryResult {
  success: boolean;
  status: 'SENT' | 'SIMULATED' | 'FAILED';
  messageId?: string;
  attemptedAt: Date;
  error?: string;
  providerName: string;
  dryRun: boolean;
}

export interface OutreachDeliveryProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  send(params: DeliveryParams): Promise<DeliveryResult>;
  getCapabilities(): { supportsHtml: boolean; supportsAttachments: boolean };
}

export interface ExecutionBatchSummary {
  totalEligible: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  results: DeliveryResult[];
}

export interface ContactDiscoveryProvider {
  readonly providerName: string;
  findContacts(businessName: string, website?: string): Promise<DiscoveredContactInput[]>;
}

export interface OutreachProvider {
  readonly providerName: string;
  generateDraft(params: {
    businessName: string;
    contactName?: string;
    niche: string;
    auditFindings?: string[];
  }): Promise<{ subject: string; body: string }>;
}

export interface EmailProvider {
  readonly providerName: string;
  sendEmail(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<SendEmailResult>;
}

export interface FollowUpProvider {
  readonly providerName: string;
  scheduleFollowUp(outreachId: string, delayDays: number): Promise<{ scheduledAt: Date }>;
}

export interface ReplyClassifierProvider {
  readonly providerName: string;
  classify(emailBody: string): Promise<{
    classification: ReplyClassification;
    confidence: number;
    sentimentScore: number;
  }>;
}

export interface SystemHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  nodeVersion: string;
  environment: string;
  database: {
    connected: boolean;
    provider: string;
    latencyMs?: number;
    error?: string;
  };
  configuration: {
    valid: boolean;
    dryRun: boolean;
    maxItemsPerRun: number;
    requestDelayMs: number;
    discoveryOsmEnabled: boolean;
    discoveryDdgEnabled: boolean;
    maxSourceRequestPerRun: number;
  };
}
