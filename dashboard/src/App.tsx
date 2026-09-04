import React, { useState, useEffect } from 'react';
import { Sidebar, PageId } from './components/Sidebar.tsx';
import { Topbar } from './components/Topbar.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { CampaignsPage } from './pages/CampaignsPage.tsx';
import { LeadsPage } from './pages/LeadsPage.tsx';
import { ReviewQueuePage } from './pages/ReviewQueuePage.tsx';
import { PilotPage } from './pages/PilotPage.tsx';
import { PhoneLeadsPage } from './pages/PhoneLeadsPage.tsx';
import { RepliesPage } from './pages/RepliesPage.tsx';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { ActivityPage } from './pages/ActivityPage.tsx';
import { SystemHealthPage } from './pages/SystemHealthPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { api } from './services/api.ts';
import { CampaignSummary } from './types/api.ts';

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [pendingReviewCount, setPendingReviewCount] = useState<number>(0);
  const [approvedCount, setApprovedCount] = useState<number>(0);
  const [systemHealthy, setSystemHealthy] = useState<boolean>(true);

  useEffect(() => {
    async function loadGlobalContext() {
      try {
        const [cList, status, health] = await Promise.all([
          api.getCampaigns(),
          api.getStatus(),
          api.getHealth(),
        ]);
        setCampaigns(cList);
        if (cList.length > 0 && !selectedCampaignId) {
          // Pre-select first active campaign
          setSelectedCampaignId(cList[0]?.id || '');
        }
        setPendingReviewCount(status.counts.pendingReview || 0);
        setApprovedCount(status.counts.approved || 0);
        setSystemHealthy(health.status === 'healthy');
      } catch (err) {
        console.error('Failed to load global context', err);
      }
    }
    loadGlobalContext();
  }, []);

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        activePage={activePage}
        onSelectPage={(page) => setActivePage(page)}
        pendingReviewCount={pendingReviewCount}
        approvedCount={approvedCount}
      />

      {/* Main Content Area */}
      <div className="main-content">
        <Topbar
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onSelectCampaign={(id) => setSelectedCampaignId(id)}
          systemHealthy={systemHealthy}
        />

        {activePage === 'overview' && (
          <OverviewPage onNavigate={(page: PageId) => setActivePage(page)} />
        )}

        {activePage === 'campaigns' && (
          <CampaignsPage
            selectedCampaignId={selectedCampaignId}
            onSelectCampaign={(id) => setSelectedCampaignId(id)}
          />
        )}

        {activePage === 'leads' && (
          <LeadsPage selectedCampaignId={selectedCampaignId} />
        )}

        {activePage === 'review' && (
          <ReviewQueuePage
            campaigns={campaigns}
            selectedCampaignId={selectedCampaignId}
            onSelectCampaign={(id) => setSelectedCampaignId(id)}
          />
        )}

        {activePage === 'pilot' && <PilotPage />}

        {activePage === 'phone-leads' && <PhoneLeadsPage />}

        {activePage === 'replies' && <RepliesPage />}

        {activePage === 'analytics' && <AnalyticsPage />}

        {activePage === 'activity' && <ActivityPage />}

        {activePage === 'health' && <SystemHealthPage />}

        {activePage === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
};
