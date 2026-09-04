// API TypeScript Interfaces for Operator Dashboard

export interface SystemStatusSummary {
  environment: string;
  database: {
    status: 'CONNECTED' | 'DISCONNECTED';
    provider: string;
    path: string;
    sizeBytes: number;
    latencyMs?: number;
    error?: string;
  };
  counts: {
    businesses: number;
    campaignsTotal: number;
    campaignsActive: number;
    leadsTotal: number;
    leadsHot: number;
    leadsWarm: number;
    leadsCold: number;
    pendingReview: number;
    approved: number;
    suppressed: number;
  };
  provider: {
    name: string;
    type: string;
    configured: boolean;
    policyStatus: string;
    coldOutreachPermitted: boolean;
    isPersonalGmail: boolean;
  };
  safety: {
    dryRun: boolean;
    outreachEnabled: boolean;
    livePilotEnabled: boolean;
    killSwitchActive: boolean;
    autoFollowupEnabled: boolean;
    testDataGuard: 'ACTIVE';
  };
  lastCampaignRun?: {
    id: string;
    status: string;
    target: number;
    startedAt: string;
    completedAt?: string | null;
  } | null;
}

export interface DetailedHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  nodeVersion: string;
  environment: string;
  database: {
    health: 'HEALTHY' | 'UNHEALTHY';
    connected: boolean;
    provider: string;
    path: string;
    accessible: boolean;
    latencyMs?: number;
    error?: string;
  };
  prisma: 'HEALTHY' | 'UNHEALTHY';
  discoveryConfig: 'READY' | 'WARNING';
  playwright: 'READY' | 'UNAVAILABLE';
  smtpConfig: 'CONFIGURED' | 'NOT_CONFIGURED';
  providerPolicy: 'PERMITTED' | 'REVIEW_REQUIRED' | 'UNSUPPORTED';
  safetyMode: {
    dryRun: boolean;
    outreachEnabled: boolean;
    livePilotEnabled: boolean;
    killSwitchActive: boolean;
    autoFollowupEnabled: boolean;
  };
}

export interface CampaignSummary {
  id: string;
  name: string;
  country: string;
  state: string;
  city: string;
  niche: string;
  targetBusinesses: number;
  minLeadScore: number;
  allowedLeadClasses: string[];
  preferredChannels: string[];
  maxDiscoveryPerRun: number;
  metrics: {
    discovered: number;
    hot: number;
    warm: number;
    emailContactable: number;
    phoneContactable: number;
    pendingReview: number;
    approved: number;
    sent: number;
    replies: number;
  };
  runState: string;
  lastRunAt?: string | null;
  createdAt: string;
}

export interface LeadListItem {
  id: string;
  businessId: string;
  businessName: string;
  city: string;
  country: string;
  niche: string;
  website: string | null;
  websiteScore: number | null;
  leadScore: number;
  leadClass: string;
  priority: string;
  email: string | null;
  isEmailVerified: boolean;
  phone: string | null;
  contactChannel: string;
  verifiedProblem: string;
  recommendedService: string;
  campaignId: string | null;
  campaignName: string | null;
  status: string;
}

export interface LeadDetail {
  id: string;
  business: {
    id: string;
    name: string;
    rawDiscoveryName: string;
    identityConfidence: string;
    city: string;
    country: string;
    address?: string | null;
    niche: string;
    website: string | null;
    source: string;
    sourceUrl?: string | null;
  };
  audit: {
    score: number;
    status: string;
    mobile?: number | null;
    performance?: number | null;
    seo?: number | null;
    accessibility?: number | null;
    ux?: number | null;
    content?: number | null;
    findings?: any[];
    topProblems: string[];
    loadTimeMs?: number | null;
    mobileResponsive?: boolean | null;
    sslValid?: boolean | null;
    hasContactForm?: boolean | null;
  } | null;
  contacts: Array<{
    id: string;
    type: string;
    value: string;
    channel: string;
    status: string;
    isVerified: boolean;
    sourceUrl?: string | null;
    emailAsFound?: string | null;
    sourceContext?: string | null;
    verifiedAt?: string | null;
  }>;
  opportunity: {
    score: number;
    classification: string;
    priority: string;
    recommendedService: string;
    salesAngle: any;
    reasoning?: string | null;
  };
  outreach: Array<{
    id: string;
    variant: string;
    subject: string;
    body: string;
    status: string;
    approvalStatus: string;
    approvedAt?: string | null;
    approvedBy?: string | null;
    qualityScore: number;
    qualityBand: string;
    contentHash?: string | null;
    sentAt?: string | null;
    repliesCount: number;
    replies?: any[];
  }>;
  suppression: {
    isSuppressed: boolean;
    records: any[];
  };
}

export interface PilotReviewItemVariant {
  outreachId: string;
  variantKey: string;
  variantLabel: string;
  subject: string;
  body: string;
  qualityScore: number;
  qualityBand: string;
  status: string;
}

export interface ReviewBusinessGroup {
  businessId: string;
  leadId: string;
  businessName: string;
  location: string;
  city: string;
  country: string;
  niche: string;
  website: string;
  leadScore: number;
  classification: string;
  problemSeverity: number;
  problem: string;
  salesAngle: string;
  auditEvidence: string[];
  recommendedService: string;
  channel: string;
  recipientEmail: string;
  provenance: {
    sourceUrl?: string | null;
    sourceType?: string | null;
    status: string;
    isVerified: boolean;
  };
  nameConfidence: string;
  variants: PilotReviewItemVariant[];
}

export interface PilotCandidate {
  outreachId: string;
  businessId: string;
  businessName: string;
  city: string;
  country: string;
  niche: string;
  website: string | null;
  recipientEmail: string;
  isVerifiedPublic: boolean;
  exactSourceUrl: string | null;
  leadScore: number;
  leadClass: string;
  variant: string;
  subject: string;
  body: string;
  status: string;
  approvalStatus: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  contentHash?: string | null;
  isSuppressed: boolean;
  cooldownActive: boolean;
  sentAt?: string | null;
  providerPolicy: string;
  liveEligibility: string;
}

export interface PhoneLead {
  leadId: string;
  businessId: string;
  businessName: string;
  phone: string;
  city: string;
  country: string;
  niche: string;
  leadScore: number;
  leadClass: string;
  website: string;
  verifiedProblem: string;
  callObjective: string;
  status: string;
  notes: string;
  updatedAt: string;
}

export interface ReplyItem {
  id: string;
  outreachId: string;
  businessId?: string | null;
  businessName: string;
  campaignName: string;
  senderEmail: string;
  receivedAt: string;
  classification: string;
  sentiment: string;
  intentCategory: string;
  body?: string | null;
  suppressionStatus: string;
  isPositive: boolean;
  isQuestion: boolean;
  isUnsubscribe: boolean;
}

export interface AnalyticsData {
  metrics: {
    totalBusinesses: number;
    hotLeads: number;
    warmLeads: number;
    contactableLeads: number;
    reviewedOutreach: number;
    approvedOutreach: number;
    realOutreachSent: number;
    repliesReceived: number;
    positiveReplies: number;
    negativeReplies: number;
    unsubscribes: number;
  };
  funnel: {
    stages: Array<{ name: string; count: number; description: string }>;
    conversions: Array<{ from: string; to: string; rate: string }>;
    hasSufficientData: boolean;
  };
  phase12Status: {
    status: string;
    title: string;
    explanation: string;
    requiredSignals: string[];
  };
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  actor: string;
  metadata?: any;
}
