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

export type FollowUpStatus =
  | 'PENDING'
  | 'FOLLOW_UP_PENDING'
  | 'FOLLOW_UP_APPROVED'
  | 'FOLLOW_UP_SENT'
  | 'FOLLOW_UP_CANCELLED'
  | 'SENT'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'SUPPRESSED';

export type ReplyClassification =
  | 'POSITIVE'
  | 'POSITIVE_INTEREST'
  | 'NEGATIVE'
  | 'QUESTION'
  | 'MORE_INFO_REQUESTED'
  | 'NOT_INTERESTED'
  | 'WRONG_PERSON'
  | 'UNSUBSCRIBE'
  | 'BOUNCE'
  | 'AUTO_REPLY'
  | 'OUT_OF_OFFICE'
  | 'UNKNOWN'
  | 'UNCLASSIFIED';

// Phase 2.5 Discovery Safety & Classification Types
export type SourceStatus =
  | 'AVAILABLE'
  | 'BLOCKED'
  | 'RATE_LIMITED'
  | 'DISABLED'
  | 'ERROR';

export type DiscoverySourceOutcome =
  | 'SUCCESS_WITH_RESULTS'
  | 'SUCCESS_EMPTY'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'QUERY_ERROR'
  | 'LOCATION_RESOLUTION_FAILED'
  | 'LOCATION_AMBIGUOUS'
  | 'SKIPPED'
  | 'DISABLED';

export type DiscoveryAggregateOutcome =
  | 'SUCCESS_WITH_RESULTS'
  | 'SUCCESS_EMPTY'
  | 'SOURCE_PARTIAL_FAILURE'
  | 'SOURCE_FAILURE';

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

export type WebsiteType =
  | 'OFFICIAL_BUSINESS_SITE'
  | 'DIRECTORY_LISTING'
  | 'AGGREGATOR'
  | 'MARKETPLACE'
  | 'SOCIAL_PROFILE'
  | 'UNKNOWN';

export type OfficialWebsiteStatus = 'VERIFIED' | 'UNVERIFIED';

export interface WebsiteClassificationResult {
  url: string;
  domain: string;
  type: WebsiteType;
  confidence: OfficialWebsiteConfidence;
  evidence: string[];
  isAuthoritative: boolean;
  isOfficialSite: boolean;
}

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
  rawName?: string;
  category: string;
  city: string;
  state?: string;
  country?: string;
  postalCode?: string;
  marketCode?: string;
  address?: string;
  phone?: string;
  phoneClassification?: 'BUSINESS_PHONE' | 'DECISION_MAKER_PHONE';
  website?: string;
  source: string;
  sourceUrl?: string;
  queryVariant?: string;
  contactChannel?: LeadContactChannel;
  websiteSource?: string;
  phoneSource?: string;
  addressSource?: string;
  officialWebsiteConfidence?: OfficialWebsiteConfidence;
  officialWebsiteStatus?: OfficialWebsiteStatus;
  websiteType?: WebsiteType;
  officialWebsiteEvidence?: string[];
  nameConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
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
  | 'BUSINESS_PHONE'
  | 'DECISION_MAKER_PHONE'
  | 'PLATFORM_CONTACT'
  | 'BUSINESS_CONTACT'
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
  emailAsFound?: string;
  sourceContext?: string;
  isVerified?: boolean;
  isPublic?: boolean;
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
  emailAsFound?: string;
  sourceContext?: string;
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

// Phase 8 Discovery Volume, Lead Channels & Multi-Market Types
export type LeadContactChannel =
  | 'WEBSITE_LEAD'
  | 'PHONE_ONLY_LEAD'
  | 'CONTACT_FORM_LEAD'
  | 'EMAIL_LEAD'
  | 'NO_CONTACT_LEAD';

export interface BusinessDiscoveryQuery {
  niche: string;
  city: string;
  country?: string;
  state?: string;
  postalCode?: string;
  limit?: number;
  maxQueries?: number;
  excludedDomains?: string[];
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
  | 'EDITED_AND_APPROVED'
  | 'READY_TO_SEND'
  | 'SENDING'
  | 'REJECTED'
  | 'SUPPRESSED'
  | 'STALE'
  | 'INVALID'
  | 'EXPIRED'
  | 'SENT'
  | 'FAILED'
  | 'REPLIED'
  | 'UNSUBSCRIBED'
  | 'FOLLOW_UP_PENDING'
  | 'COMPLETED';

export type ApprovalAction = 'APPROVE' | 'REJECT' | 'EDIT' | 'SKIP' | 'QUIT';

export interface ApprovalAuditRecord {
  reviewedAt: Date;
  reviewedBy: string;
  approvalStatus: 'APPROVED' | 'REJECTED' | 'EDITED_AND_APPROVED' | 'REVIEW_REQUIRED';
  originalSubject?: string;
  originalBody?: string;
  finalSubject?: string;
  finalBody?: string;
  rejectionReason?: string;
  editTimestamp?: Date;
  approvalTimestamp?: Date;
}

export interface InboundReplyInput {
  outreachId: string;
  senderEmail?: string;
  recipient?: string;
  businessId?: string;
  messageId?: string;
  threadId?: string;
  replyBody: string;
  replyReceivedAt?: Date;
}

export interface InboundReplyRecord {
  id: string;
  outreachId: string;
  senderEmail?: string;
  recipient?: string;
  businessId?: string;
  messageId?: string;
  threadId?: string;
  body: string;
  classification: ReplyClassification;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  followUpStatus: FollowUpStatus;
  replyReceivedAt: Date;
}

export interface PhoneCallScript {
  businessName: string;
  phone: string;
  location: string;
  score: number;
  problem: string;
  recommendedService: RecommendedService;
  suggestedObjective: string;
  suggestedOpening: string;
  websiteStatus: string;
  nameConfidence: string;
}

export type LifecycleEvent =
  | 'DISCOVERED'
  | 'AUDITED'
  | 'QUALIFIED'
  | 'CONTACT_FOUND'
  | 'PERSONALIZED'
  | 'REVIEWED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SEND_BLOCKED'
  | 'SEND_ATTEMPTED'
  | 'SEND_SUCCESS'
  | 'SEND_FAILED'
  | 'REPLY_RECEIVED'
  | 'SUPPRESSED';

export interface PreSendValidationResult {
  allowed: boolean;
  status: 'ALLOWED' | 'BLOCKED';
  reasons: string[];
  warnings: string[];
  details: {
    hasHumanApproval: boolean;
    validBusinessIdentity: boolean;
    validVerifiedEmail: boolean;
    isGuessedEmail: boolean;
    isSuppressed: boolean;
    isCooldownActive: boolean;
    validDraft: boolean;
    noProhibitedClaims: boolean;
    noHallucinatedMetrics: boolean;
    correctBusinessName: boolean;
    correctCity: boolean;
    senderConfigured: boolean;
    pilotLimitOk: boolean;
    killSwitchActive: boolean;
    legalComplianceValid?: boolean;
    providerPolicyValid?: boolean;
    providerPolicyStatus?: ProviderPolicyStatus;
  };
}

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
  outreachType?: OutreachContextType;
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

export type OutreachContextType =
  | 'COLD_COMMERCIAL'
  | 'TRANSACTIONAL'
  | 'RELATIONSHIP'
  | 'INBOUND_REPLY'
  | 'USER_INITIATED'
  | 'REPLY'
  | 'PERSONAL';

export type ProviderType =
  | 'GMAIL_SMTP'
  | 'GOOGLE_WORKSPACE'
  | 'CUSTOM_SMTP'
  | 'SENDGRID'
  | 'POSTMARK'
  | 'MAILGUN'
  | 'RESEND'
  | 'SES'
  | 'MOCK'
  | 'UNKNOWN';

export type ProviderPolicyStatus =
  | 'PERMITTED'
  | 'UNSUPPORTED'
  | 'REVIEW_REQUIRED';

export interface ProviderPolicyCheckResult {
  status: ProviderPolicyStatus;
  reasonCode?: string;
  message?: string;
}

export interface ProviderCapabilities {
  supportsHtml: boolean;
  supportsAttachments: boolean;
  supportsCommercialColdOutreach: boolean;
  providerPolicyStatus: ProviderPolicyStatus;
  providerType: ProviderType;
}

export interface OutreachDeliveryProvider {
  readonly name: string;
  readonly isNetworkTransport?: boolean;
  isAvailable(): Promise<boolean>;
  send(params: DeliveryParams): Promise<DeliveryResult>;
  getCapabilities(): ProviderCapabilities;
  getProviderPolicyStatus(context?: { outreachType?: OutreachContextType }): ProviderPolicyCheckResult;
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

// ------------------------------------------------------------------------------
// Phase 9 Campaign Configuration, Funnel & Conversion Workflow Types
// ------------------------------------------------------------------------------

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export interface CampaignRecord {
  id: string;
  name: string;
  country: string;
  state?: string | null;
  city: string;
  niche: string;
  canonicalNiche?: string;
  displayNiche?: string;
  rawNiche?: string;
  targetBusinesses: number;
  minLeadScore: number;
  minContactQuality: number;
  maxDiscoveryPerRun: number;
  maxEmailsPerDay: number;
  targetWebsiteOpportunity?: number | null;
  preferredService: string;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignInput {
  name: string;
  country?: string;
  state?: string;
  city: string;
  niche: string;
  canonicalNiche?: string;
  rawNiche?: string;
  targetBusinesses?: number;
  minLeadScore?: number;
  minContactQuality?: number;
  maxDiscoveryPerRun?: number;
  maxEmailsPerDay?: number;
  targetWebsiteOpportunity?: number;
  preferredService?: string;
}

export interface CampaignFunnelStage {
  stage: string;
  count: number;
  percentage: number;
  conversionFromPrevious: number;
  dropOffCount: number;
  dropOffPercentage: number;
}

export interface ContactabilityBreakdown {
  digitalContactable: number;
  digitalContactRate: number;
  emailCount: number;
  formCount: number;
  phoneContactable: number;
  phoneContactRate: number;
  businessPhoneCount: number;
  totalContactable: number;
  totalContactRate: number;
  noContact: number;
  noContactRate: number;
}

export interface CampaignFunnelSummary {
  campaignId: string;
  campaignName: string;
  stages: CampaignFunnelStage[];
  contactability?: ContactabilityBreakdown;
  bottleneckStage: string;
  bottleneckReason: string;
}

export interface CampaignPacingSummary {
  targetTotal: number;
  achieved: number;
  remaining: number;
  avgPerDayRequired: number;
  currentAvgPerDay: number;
  projectedCompletionDate: Date | null;
  onTrack: boolean;
}

export interface MarketPerformanceMetric {
  market: string;
  country: string;
  state?: string;
  city: string;
  niche: string;
  discoveredTotal: number;
  qualifiedTotal: number;
  qualificationRate: number;
  digitalContactable: number;
  digitalContactRate: number;
  phoneContactable: number;
  phoneContactRate: number;
  contactableTotal: number;
  contactRate: number;
  noContactTotal: number;
  hotCount: number;
  hotRate: number;
  warmCount: number;
  warmRate: number;
  avgLeadScore: number;
  avgContactQuality: number;
  websiteAvailabilityRate: number;
}

export interface ServiceDemandMetric {
  service: RecommendedService;
  leadCount: number;
  avgLeadScore: number;
  hotCount: number;
  warmCount: number;
  contactableCount: number;
}

export interface LeadQueueItem {
  id: string;
  businessId: string;
  businessName: string;
  city: string;
  state?: string;
  country: string;
  address?: string;
  phone?: string;
  niche: string;
  website?: string;
  leadScore: number;
  classification: LeadClassification;
  priorityRank: number;
  contactValue?: string;
  contactType: string;
  contactQualityScore: number;
  problemSeverity: number;
  dataConfidence: AuditConfidence;
  recommendedService: RecommendedService;
  salesAngleText?: string;
  recommendedChannel: 'PHONE' | 'EMAIL' | 'CONTACT_FORM';
  suggestedObjective?: string;
  suggestedOpening?: string;
  websiteStatus?: string;
  nameConfidence?: string;
  status: string;
}

export interface ReviewQueueItem {
  outreachId: string;
  leadId: string;
  businessId: string;
  businessName: string;
  city: string;
  website?: string;
  leadScore: number;
  classification: string;
  websiteQualityScore: number;
  contactValue?: string;
  contactType: string;
  salesAngle: string;
  recommendedService: string;
  subject: string;
  bodyPreview: string;
  qualityScore: number;
  qualityBand: QualityBand;
  evidenceValid: boolean;
  identityValid: boolean;
  isSuppressed: boolean;
  status: OutreachLifecycleStatus;
  approvedAt?: Date;
  approvedBy?: string;
}

export interface ReviewQueueFilters {
  campaignId?: string;
  country?: string;
  emailOnly?: boolean;
  pilotEligible?: boolean;
  minClass?: 'HOT_OR_WARM' | 'ALL';
  includeTest?: boolean;
}


