import React, { useState, useEffect } from 'react';
import { CampaignProvider, useCampaign } from './context/CampaignContext.tsx';
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

const AppContent: React.FC = () => {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const [systemHealthy, setSystemHealthy] = useState<boolean>(true);
  const {
    campaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    pendingReviewCount,
    approvedCount,
  } = useCampaign();

  useEffect(() => {
    async function checkHealth() {
      try {
        const health = await api.getHealth();
        setSystemHealthy(health.status === 'healthy');
      } catch (err) {
        console.error('Failed to load health status', err);
      }
    }
    checkHealth();
  }, []);

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        activePage={activePage}
        onSelectPage={(page) => setActivePage(page)}
        selectedCampaignId={selectedCampaignId}
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
          <ReviewQueuePage />
        )}

        {activePage === 'pilot' && (
          <PilotPage />
        )}

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

export const App: React.FC = () => {
  return (
    <CampaignProvider>
      <AppContent />
    </CampaignProvider>
  );
};
