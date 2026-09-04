// Frontend API Client calling local Express backend

import {
  SystemStatusSummary,
  DetailedHealthStatus,
  NavigationSummary,
  CampaignSummary,
  LeadListItem,
  LeadDetail,
  ReviewBusinessGroup,
  PilotCandidate,
  PhoneLead,
  ReplyItem,
  AnalyticsData,
  ActivityEvent,
} from '../types/api.ts';

const BASE_URL = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const json = await res.json();
  if (!res.ok || json.status === 'error') {
    throw new Error(json.message || `API request failed with status ${res.status}`);
  }

  return json.data as T;
}

export const api = {
  // System Status & Health
  getStatus: () => request<SystemStatusSummary>('/status'),
  getHealth: () => request<DetailedHealthStatus>('/health'),
  getNavigationSummary: (campaignId?: string) => {
    const qs = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    return request<NavigationSummary>(`/navigation-summary${qs}`);
  },

  // Campaigns
  getCampaigns: () => request<CampaignSummary[]>('/campaigns'),
  getCampaign: (id: string) => request<any>(`/campaigns/${id}`),
  createCampaign: (data: any) =>
    request<any>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  runCampaign: (id: string, options?: { maxItems?: number; mock?: boolean }) =>
    request<any>(`/campaigns/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),
  getCampaignProgress: (id: string) => request<any>(`/campaigns/${id}/progress`),

  // Leads
  getLeads: (params: Record<string, string | number | boolean | undefined>) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== '') {
        searchParams.append(key, String(val));
      }
    });
    return request<{ items: LeadListItem[]; pagination: any }>(`/leads?${searchParams.toString()}`);
  },
  getLeadDetail: (id: string) => request<LeadDetail>(`/leads/${id}`),

  // Review Queue
  getReviewQueue: (campaignId: string, limit: number = 50) =>
    request<{ campaignId: string; totalItems: number; items: ReviewBusinessGroup[] }>(
      `/review?campaignId=${encodeURIComponent(campaignId)}&limit=${limit}`
    ),
  editDraft: (outreachId: string, data: { subject: string; body: string }) =>
    request<any>(`/review/${outreachId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  approveDraft: (outreachId: string, operator: string = 'HUMAN_OPERATOR') =>
    request<any>(`/review/${outreachId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ operator }),
    }),
  rejectBusiness: (businessId: string, reason: string, operator: string = 'HUMAN_OPERATOR') =>
    request<any>('/review/reject-business', {
      method: 'POST',
      body: JSON.stringify({ businessId, reason, operator }),
    }),

  // Pilot & Safe Dry-Run
  getPilotCandidates: (campaignId?: string) => {
    const qs = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    return request<{ total: number; candidates: PilotCandidate[]; providerPolicy: any }>(
      `/pilot/candidates${qs}`
    );
  },
  previewPilot: (params: { limit?: number; campaignId?: string; country?: string }) => {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.append('limit', String(params.limit));
    if (params.campaignId) searchParams.append('campaignId', params.campaignId);
    if (params.country) searchParams.append('country', params.country);
    return request<any>(`/pilot/preview?${searchParams.toString()}`);
  },
  runDryRun: (params: { limit?: number; campaignId?: string }) =>
    request<any>('/pilot/dry-run', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  attemptLiveSend: () =>
    request<any>('/pilot/live-send', {
      method: 'POST',
    }),

  // Phone Leads
  getPhoneLeads: (page: number = 1, limit: number = 20) =>
    request<{ items: PhoneLead[]; pagination: any }>(`/phone-leads?page=${page}&limit=${limit}`),
  markPhoneContacted: (leadId: string, status: string = 'CONTACTED') =>
    request<any>(`/phone-leads/${leadId}/contacted`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  addPhoneNote: (leadId: string, note: string) =>
    request<any>(`/phone-leads/${leadId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  // Replies
  getReplies: (classification?: string) => {
    const qs = classification ? `?classification=${encodeURIComponent(classification)}` : '';
    return request<{ total: number; items: ReplyItem[] }>(`/replies${qs}`);
  },

  // Analytics
  getAnalytics: () => request<AnalyticsData>('/analytics'),

  // Activity Log
  getActivity: (limit: number = 50, filters?: { eventType?: string }) => {
    const searchParams = new URLSearchParams({ limit: String(limit) });
    if (filters?.eventType) searchParams.append('eventType', filters.eventType);
    return request<{ total: number; items: ActivityEvent[] }>(`/activity?${searchParams.toString()}`);
  },

  // Database Backup & Restore
  getBackups: () => request<any[]>('/database/backups'),
  createBackup: () => request<any>('/database/backup', { method: 'POST' }),
  restoreBackup: (filename: string, confirmationToken: string) =>
    request<any>('/database/restore', {
      method: 'POST',
      body: JSON.stringify({ filename, confirmationToken }),
    }),

  // Settings
  getSettings: () => request<any>('/settings'),
};
