import React from 'react';
import { StatusBadge } from './StatusBadge.tsx';
import { CampaignSummary } from '../types/api.ts';
import { useCampaign } from '../context/CampaignContext.tsx';

interface TopbarProps {
  campaigns?: CampaignSummary[];
  selectedCampaignId?: string;
  onSelectCampaign?: (id: string) => void;
  systemHealthy?: boolean;
}

export const Topbar: React.FC<TopbarProps> = ({
  campaigns: propCampaigns,
  selectedCampaignId: propSelectedId,
  onSelectCampaign: propOnSelect,
  systemHealthy = true,
}) => {
  let context: ReturnType<typeof useCampaign> | null = null;
  try {
    context = useCampaign();
  } catch {
    context = null;
  }

  const campaigns = propCampaigns ?? context?.campaigns ?? [];
  const selectedCampaignId = propSelectedId !== undefined ? propSelectedId : (context?.selectedCampaignId ?? '');
  const onSelectCampaign = propOnSelect ?? context?.setSelectedCampaignId ?? (() => {});
  return (
    <header className="topbar" aria-label="Status Bar">
      <div className="topbar-left">
        <label htmlFor="topbar-campaign" style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
          ACTIVE CAMPAIGN:
        </label>
        <select
          id="topbar-campaign"
          className="topbar-campaign-select"
          value={selectedCampaignId}
          onChange={(e) => onSelectCampaign(e.target.value)}
        >
          <option value="">
            {campaigns.length === 0 ? 'No Active Campaign' : '-- All Campaigns / Global View --'}
          </option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.city}, {c.niche})
            </option>
          ))}
        </select>
      </div>

      <div className="topbar-badges">
        <StatusBadge status="DRY RUN" label="DRY RUN" />
        <StatusBadge status="BLOCKED" label="KILL SWITCH ACTIVE" />
        <StatusBadge status="BLOCKED" label="GMAIL BLOCKED" />
        <StatusBadge
          status={systemHealthy ? 'HEALTHY' : 'WARNING'}
          label={systemHealthy ? 'SYSTEM HEALTHY' : 'SYSTEM DEGRADED'}
        />
      </div>
    </header>
  );
};
