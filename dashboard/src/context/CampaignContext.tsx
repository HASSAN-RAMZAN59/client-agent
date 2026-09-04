import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api.ts';
import { CampaignSummary } from '../types/api.ts';

export interface CampaignContextType {
  campaigns: CampaignSummary[];
  selectedCampaignId: string;
  selectedCampaign: CampaignSummary | null;
  setSelectedCampaignId: (id: string) => void;
  pendingReviewCount: number;
  approvedCount: number;
  refreshNavigationSummary: (campaignId?: string) => Promise<void>;
  reloadCampaigns: () => Promise<CampaignSummary[]>;
  loading: boolean;
}

const CampaignContext = createContext<CampaignContextType | undefined>(undefined);

export const CampaignProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selectedCampaignId, setSelectedCampaignIdState] = useState<string>('');
  const [pendingReviewCount, setPendingReviewCount] = useState<number>(0);
  const [approvedCount, setApprovedCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Sequence counter to prevent out-of-order race conditions on rapid switching
  const requestIdRef = useRef<number>(0);

  const reloadCampaigns = useCallback(async () => {
    try {
      const cList = await api.getCampaigns();
      setCampaigns(cList);
      return cList;
    } catch (err) {
      console.error('Failed to load campaigns in context', err);
      return [];
    }
  }, []);

  const refreshNavigationSummary = useCallback(async (campaignIdToFetch?: string) => {
    const targetId = campaignIdToFetch !== undefined ? campaignIdToFetch : selectedCampaignId;
    const currentRequestId = ++requestIdRef.current;

    try {
      const summary = await api.getNavigationSummary(targetId || undefined);
      // Discard response if a newer request was dispatched
      if (currentRequestId === requestIdRef.current) {
        setPendingReviewCount(summary.pendingReview);
        setApprovedCount(summary.readyToSend);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        console.error('Failed to fetch navigation summary', err);
      }
    }
  }, [selectedCampaignId]);

  const setSelectedCampaignId = useCallback((id: string) => {
    setSelectedCampaignIdState(id);
  }, []);

  // When selectedCampaignId changes, fetch navigation summary for that scope
  useEffect(() => {
    refreshNavigationSummary(selectedCampaignId);
  }, [selectedCampaignId, refreshNavigationSummary]);

  // Initial load
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const cList = await reloadCampaigns();
        if (cList.length > 0) {
          setSelectedCampaignIdState((prev) => (cList.some((c) => c.id === prev) ? prev : cList[0]?.id || ''));
        } else {
          setSelectedCampaignIdState('');
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [reloadCampaigns]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) || null;

  return (
    <CampaignContext.Provider
      value={{
        campaigns,
        selectedCampaignId,
        selectedCampaign,
        setSelectedCampaignId,
        pendingReviewCount,
        approvedCount,
        refreshNavigationSummary,
        reloadCampaigns,
        loading,
      }}
    >
      {children}
    </CampaignContext.Provider>
  );
};

export const useCampaign = (): CampaignContextType => {
  const context = useContext(CampaignContext);
  if (!context) {
    throw new Error('useCampaign must be used within a CampaignProvider');
  }
  return context;
};
