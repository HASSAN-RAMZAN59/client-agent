import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { CampaignSummary } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { Play, Plus, X, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';

export const CampaignsPage: React.FC<{
  onSelectCampaign: (id: string) => void;
  selectedCampaignId: string;
}> = ({ onSelectCampaign, selectedCampaignId }) => {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCity, setFilterCity] = useState('');
  const [filterNiche, setFilterNiche] = useState('');

  // Create Campaign Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    country: 'US',
    state: 'TX',
    city: '',
    niche: '',
    targetBusinesses: 50,
    minScore: 50,
    hotClass: true,
    warmClass: true,
    channelEmail: true,
    channelPhone: true,
  });
  const [createdSummary, setCreatedSummary] = useState<any | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Run Campaign Confirmation Modal State
  const [runCampaignTarget, setRunCampaignTarget] = useState<CampaignSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<any | null>(null);

  // Campaign Detail Drawer State
  const [detailCampaign, setDetailCampaign] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    try {
      setLoading(true);
      const data = await api.getCampaigns();
      setCampaigns(data);
    } catch (err: any) {
      console.error('Failed to load campaigns', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (!formData.name.trim()) {
      setCreateError('Campaign name is required');
      return;
    }
    if (!formData.city.trim()) {
      setCreateError('City is required');
      return;
    }
    if (!formData.niche.trim()) {
      setCreateError('Niche is required');
      return;
    }

    try {
      const allowedLeadClasses = [];
      if (formData.hotClass) allowedLeadClasses.push('HOT');
      if (formData.warmClass) allowedLeadClasses.push('WARM');

      const preferredChannels = [];
      if (formData.channelEmail) preferredChannels.push('EMAIL');
      if (formData.channelPhone) preferredChannels.push('PHONE');

      const res = await api.createCampaign({
        name: formData.name.trim(),
        country: formData.country.trim().toUpperCase(),
        state: formData.state.trim() || undefined,
        city: formData.city.trim(),
        niche: formData.niche.trim(),
        targetBusinesses: Number(formData.targetBusinesses),
        minScore: Number(formData.minScore),
        allowedLeadClasses,
        preferredChannels,
      });

      setCreatedSummary(res);
      await loadCampaigns();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create campaign');
    }
  }

  async function handleOpenDetail(campaignId: string) {
    try {
      setLoadingDetail(true);
      const data = await api.getCampaign(campaignId);
      setDetailCampaign(data);
    } catch (err: any) {
      console.error('Failed to fetch campaign detail', err);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleExecuteRun() {
    if (!runCampaignTarget) return;

    try {
      setIsRunning(true);
      const runRes = await api.runCampaign(runCampaignTarget.id, {
        maxItems: runCampaignTarget.targetBusinesses,
        mock: false,
      });

      // Poll actual persisted stage progress
      const pollInterval = setInterval(async () => {
        try {
          const p = await api.getCampaignProgress(runCampaignTarget.id);
          if (p.hasRun && p.run) {
            setRunProgress(p.run);
            if (p.run.status === 'COMPLETED' || p.run.status === 'FAILED' || p.run.status === 'PARTIAL_FAILURE') {
              clearInterval(pollInterval);
              setIsRunning(false);
              await loadCampaigns();
            }
          }
        } catch {
          clearInterval(pollInterval);
          setIsRunning(false);
        }
      }, 1500);
    } catch (err: any) {
      setIsRunning(false);
      alert(`Pipeline execution error: ${err.message}`);
    }
  }

  const filteredCampaigns = campaigns.filter((c) => {
    if (filterCity && !c.city.toLowerCase().includes(filterCity.toLowerCase())) return false;
    if (filterNiche && !c.niche.toLowerCase().includes(filterNiche.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">
            Configure target markets, monitor discovery runs, and manage lead generation pipelines
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowCreateModal(true);
            setCreatedSummary(null);
            setCreateError(null);
          }}
        >
          <Plus size={16} /> Create Campaign
        </button>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          type="text"
          className="form-input"
          style={{ width: '220px' }}
          placeholder="Filter by City..."
          value={filterCity}
          onChange={(e) => setFilterCity(e.target.value)}
        />
        <input
          type="text"
          className="form-input"
          style={{ width: '220px' }}
          placeholder="Filter by Niche (e.g. HVAC, Dental)..."
          value={filterNiche}
          onChange={(e) => setFilterNiche(e.target.value)}
        />
        {(filterCity || filterNiche) && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              setFilterCity('');
              setFilterNiche('');
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Campaigns Table */}
      <div className="table-container">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <div style={{ marginTop: '12px' }}>Loading campaigns...</div>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No campaigns found</div>
            <p>Create a new target campaign to begin local discovery.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Location</th>
                <th>Niche</th>
                <th>Target</th>
                <th>Discovered</th>
                <th>HOT</th>
                <th>WARM</th>
                <th>Email Verified</th>
                <th>Phone</th>
                <th>Pending Review</th>
                <th>Approved</th>
                <th>Sent</th>
                <th>Run State</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    {c.city}, {c.state || c.country}
                  </td>
                  <td>{c.niche}</td>
                  <td>{c.targetBusinesses}</td>
                  <td style={{ fontWeight: 600 }}>{c.metrics.discovered}</td>
                  <td style={{ color: '#f87171', fontWeight: 600 }}>{c.metrics.hot}</td>
                  <td style={{ color: '#fbbf24', fontWeight: 600 }}>{c.metrics.warm}</td>
                  <td style={{ color: '#34d399', fontWeight: 600 }}>{c.metrics.emailContactable}</td>
                  <td>{c.metrics.phoneContactable}</td>
                  <td style={{ color: '#38bdf8', fontWeight: 600 }}>{c.metrics.pendingReview}</td>
                  <td style={{ color: '#60a5fa', fontWeight: 600 }}>{c.metrics.approved}</td>
                  <td>{c.metrics.sent}</td>
                  <td>
                    <StatusBadge status={c.runState} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => handleOpenDetail(c.id)}
                      >
                        Detail
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => {
                          setRunCampaignTarget(c);
                          setRunProgress(null);
                        }}
                      >
                        <Play size={12} /> Run
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CREATE CAMPAIGN MODAL */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">Create New Campaign</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setShowCreateModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            {createdSummary ? (
              <div className="modal-body">
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <CheckCircle2 size={40} color="#34d399" style={{ margin: '0 auto 10px auto' }} />
                  <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: 700 }}>
                    Campaign Created Successfully
                  </h3>
                </div>
                <div style={{ background: '#0b0f17', padding: '16px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6 }}>
                  <div><strong>Campaign ID:</strong> <span style={{ fontFamily: 'monospace' }}>{createdSummary.campaign.id}</span></div>
                  <div><strong>Name:</strong> {createdSummary.campaign.name}</div>
                  <div><strong>Target:</strong> {createdSummary.campaign.city}, {createdSummary.campaign.country} ({createdSummary.campaign.niche})</div>
                  <div><strong>Safety Status:</strong> <StatusBadge status="DRY RUN" /></div>
                  <div><strong>Provider Policy:</strong> <StatusBadge status="BLOCKED" label={createdSummary.providerPolicy.status} /></div>
                </div>
                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreatedSummary(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateCampaign}>
                <div className="modal-body">
                  {createError && (
                    <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '10px 14px', borderRadius: '6px', color: '#f87171', marginBottom: '16px', fontSize: '13px' }}>
                      {createError}
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">Campaign Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Austin HVAC Redesign Q4"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">City *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Austin"
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">State</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="TX"
                        value={formData.state}
                        onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Country</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="US"
                        value={formData.country}
                        onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Niche / Industry *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="HVAC, Dental, Legal..."
                      value={formData.niche}
                      onChange={(e) => setFormData({ ...formData, niche: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">Target Businesses</label>
                      <input
                        type="number"
                        className="form-input"
                        min="1"
                        max="100"
                        value={formData.targetBusinesses}
                        onChange={(e) => setFormData({ ...formData, targetBusinesses: Number(e.target.value) })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Min Lead Score</label>
                      <input
                        type="number"
                        className="form-input"
                        min="0"
                        max="100"
                        value={formData.minScore}
                        onChange={(e) => setFormData({ ...formData, minScore: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Allowed Lead Classes</label>
                    <div style={{ display: 'flex', gap: '20px', marginTop: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formData.hotClass}
                          onChange={(e) => setFormData({ ...formData, hotClass: e.target.checked })}
                        />
                        <span>HOT Leads (≥70)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formData.warmClass}
                          onChange={(e) => setFormData({ ...formData, warmClass: e.target.checked })}
                        />
                        <span>WARM Leads (50-69)</span>
                      </label>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Preferred Channels</label>
                    <div style={{ display: 'flex', gap: '20px', marginTop: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formData.channelEmail}
                          onChange={(e) => setFormData({ ...formData, channelEmail: e.target.checked })}
                        />
                        <span>Email Outreach</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formData.channelPhone}
                          onChange={(e) => setFormData({ ...formData, channelPhone: e.target.checked })}
                        />
                        <span>Phone Lead Tracking</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Create Campaign
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* RUN CAMPAIGN CONFIRMATION & LIVE TRACKING MODAL */}
      {runCampaignTarget && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">Execute Campaign Pipeline</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => {
                  setRunCampaignTarget(null);
                  setRunProgress(null);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
                  {runCampaignTarget.name}
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                  Location: {runCampaignTarget.city}, {runCampaignTarget.country} | Niche: {runCampaignTarget.niche}
                </div>
              </div>

              <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6, marginBottom: '20px' }}>
                <div><strong>Target Limit:</strong> {runCampaignTarget.targetBusinesses} businesses</div>
                <div><strong>Discovery Provider:</strong> OpenStreetMap / DuckDuckGo Public Index</div>
                <div><strong>Audit Engine:</strong> Comprehensive UX / Performance / SEO / Accessibility</div>
                <div><strong>Scoring Engine:</strong> Multi-Factor Lead Scoring (0-100)</div>
                <div><strong>Safety Invariants:</strong> DRY_RUN=true (Zero Network Emails)</div>
              </div>

              {runProgress ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                      Current Stage: <StatusBadge status={runProgress.status} />
                    </div>
                    {isRunning && <div className="loading-spinner" style={{ width: '16px', height: '16px' }}></div>}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                    <div style={{ background: '#131d31', padding: '10px', borderRadius: '6px' }}>
                      Discovered: <strong>{runProgress.discovered || 0} / {runProgress.target}</strong>
                    </div>
                    <div style={{ background: '#131d31', padding: '10px', borderRadius: '6px' }}>
                      Audited: <strong>{runProgress.audited || 0}</strong>
                    </div>
                    <div style={{ background: '#131d31', padding: '10px', borderRadius: '6px' }}>
                      Qualified Leads: <strong>{runProgress.hot || 0}</strong>
                    </div>
                    <div style={{ background: '#131d31', padding: '10px', borderRadius: '6px' }}>
                      Verified Contacts: <strong>{runProgress.emailContactable || 0}</strong>
                    </div>
                    <div style={{ background: '#131d31', padding: '10px', borderRadius: '6px' }}>
                      Drafts Generated: <strong>{runProgress.draftsGenerated || 0}</strong>
                    </div>
                    <div style={{ background: '#131d31', padding: '10px', borderRadius: '6px' }}>
                      Review Ready: <strong>{runProgress.reviewRequired || 0}</strong>
                    </div>
                  </div>

                  {runProgress.status === 'COMPLETED' && (
                    <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '6px', color: '#34d399', fontSize: '13px' }}>
                      ✓ Pipeline run completed successfully. Leads and drafts are ready for operator review.
                    </div>
                  )}

                  {runProgress.errorMessage && (
                    <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#f87171', fontSize: '13px' }}>
                      Note: {runProgress.errorMessage}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Clicking "Start Pipeline" will trigger business discovery, full website audits, lead qualification, contact verification, and personalized draft creation.
                </p>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isRunning}
                onClick={() => {
                  setRunCampaignTarget(null);
                  setRunProgress(null);
                }}
              >
                Close
              </button>
              {!runProgress || runProgress.status === 'CREATED' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isRunning}
                  onClick={handleExecuteRun}
                >
                  {isRunning ? 'Running...' : 'Start Pipeline'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* CAMPAIGN DETAIL DRAWER */}
      {detailCampaign && (
        <div className="drawer-overlay" onClick={() => setDetailCampaign(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">{detailCampaign.campaign.name}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  ID: {detailCampaign.campaign.id}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setDetailCampaign(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '10px' }}>
                  Target Configuration
                </h4>
                <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6 }}>
                  <div><strong>Locality:</strong> {detailCampaign.campaign.city}, {detailCampaign.campaign.country}</div>
                  <div><strong>Niche:</strong> {detailCampaign.campaign.niche}</div>
                  <div><strong>Target Quantity:</strong> {detailCampaign.campaign.targetBusinesses} businesses</div>
                  <div><strong>Min Lead Score:</strong> {detailCampaign.campaign.minLeadScore}</div>
                  <div><strong>Total Linked Members:</strong> {detailCampaign.membersCount} businesses</div>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '10px' }}>
                  Execution State Machine
                </h4>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    'CREATED',
                    'DISCOVERING',
                    'AUDITING',
                    'SCORING',
                    'CONTACT_DISCOVERY',
                    'PERSONALIZING',
                    'REVIEW_READY',
                    'COMPLETED',
                  ].map((st) => (
                    <StatusBadge
                      key={st}
                      status={detailCampaign.latestRun?.status === st ? 'HEALTHY' : 'PENDING'}
                      label={st}
                    />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '10px' }}>
                  Execution History
                </h4>
                {detailCampaign.runs && detailCampaign.runs.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {detailCampaign.runs.map((r: any) => (
                      <div key={r.id} style={{ background: '#131d31', padding: '10px 14px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '12px' }}>
                            Run {r.id.substring(0, 8)} — Target: {r.target}
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            Started: {new Date(r.startedAt).toLocaleString()}
                          </div>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#64748b', fontSize: '13px' }}>No runs executed yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
