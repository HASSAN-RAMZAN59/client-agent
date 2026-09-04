import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { SystemStatusSummary, AnalyticsData } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { ShieldAlert, ShieldCheck, Mail, AlertTriangle, ArrowRight } from 'lucide-react';

export const OverviewPage: React.FC<{ onNavigate: (page: any) => void }> = ({ onNavigate }) => {
  const [status, setStatus] = useState<SystemStatusSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [sData, aData] = await Promise.all([api.getStatus(), api.getAnalytics()]);
        setStatus(sData);
        setAnalytics(aData);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load system status');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="loading-spinner"></div>
          <div style={{ marginTop: '12px' }}>Connecting to local database...</div>
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-title" style={{ color: '#f87171' }}>
            Failed to connect to backend
          </div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const { counts, safety, provider, database } = status;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operator Overview</h1>
          <p className="page-subtitle">
            Authoritative SQLite pipeline state & local system operational status
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => window.location.reload()}>
          Refresh Data
        </button>
      </div>

      {/* Prominent Safety Alert Banner */}
      <div className="safety-banner">
        <div>
          <div className="safety-banner-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} color="#38bdf8" />
            SAFETY CONTROLS ACTIVE — ZERO COLD LIVE OUTREACH PERMITTED
          </div>
          <div className="safety-banner-desc">
            Dry-run simulation mode is enforced. Personal Gmail is strictly blocked from commercial cold outreach. All network sends remain zero.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatusBadge status="DRY RUN" />
          <StatusBadge status="BLOCKED" label="KILL SWITCH" />
          <StatusBadge status="BLOCKED" label="GMAIL BLOCKED" />
        </div>
      </div>

      {/* 12 Metric Cards */}
      <div className="grid-cards">
        <div className="card">
          <div className="card-label">Total Businesses</div>
          <div className="card-value">{counts.businesses}</div>
          <div className="card-subtext">Discovered & persisted</div>
        </div>

        <div className="card">
          <div className="card-label">Active Campaigns</div>
          <div className="card-value">{counts.campaignsActive}</div>
          <div className="card-subtext">{counts.campaignsTotal} total defined</div>
        </div>

        <div className="card">
          <div className="card-label">HOT Leads</div>
          <div className="card-value" style={{ color: '#f87171' }}>
            {counts.leadsHot}
          </div>
          <div className="card-subtext">Highest opportunity score</div>
        </div>

        <div className="card">
          <div className="card-label">WARM Leads</div>
          <div className="card-value" style={{ color: '#fbbf24' }}>
            {counts.leadsWarm}
          </div>
          <div className="card-subtext">Moderate opportunity score</div>
        </div>

        <div className="card">
          <div className="card-label">Email Contactable</div>
          <div className="card-value">
            {counts.emailContactable ?? analytics?.metrics.contactableLeads ?? 0}
          </div>
          <div className="card-subtext">Verified public email</div>
        </div>

        <div className="card">
          <div className="card-label">Phone Contactable</div>
          <div className="card-value">
            {counts.phoneContactable ?? 0}
          </div>
          <div className="card-subtext">Phone number available</div>
        </div>

        <div className="card">
          <div className="card-label">Pending Review</div>
          <div className="card-value" style={{ color: '#38bdf8' }}>
            {counts.pendingReview}
          </div>
          <div className="card-subtext">Unique businesses awaiting sign-off</div>
        </div>

        <div className="card">
          <div className="card-label">Approved</div>
          <div className="card-value" style={{ color: '#34d399' }}>
            {counts.approved}
          </div>
          <div className="card-subtext">Selected outreach drafts</div>
        </div>

        <div className="card">
          <div className="card-label">Ready To Send</div>
          <div className="card-value" style={{ color: '#c084fc' }}>
            {counts.readyToSend ?? counts.approved}
          </div>
          <div className="card-subtext">Frozen pilot candidates</div>
        </div>

        <div className="card">
          <div className="card-label">Real Sends</div>
          <div className="card-value">
            {counts.realSends ?? analytics?.metrics.realOutreachSent ?? 0}
          </div>
          <div className="card-subtext">Network dispatches (0)</div>
        </div>

        <div className="card">
          <div className="card-label">Replies Received</div>
          <div className="card-value">
            {counts.replies ?? analytics?.metrics.repliesReceived ?? 0}
          </div>
          <div className="card-subtext">Inbound responses</div>
        </div>

        <div className="card">
          <div className="card-label">Positive Replies</div>
          <div className="card-value" style={{ color: '#34d399' }}>
            {counts.positiveReplies ?? analytics?.metrics.positiveReplies ?? 0}
          </div>
          <div className="card-subtext">Interested prospects</div>
        </div>
      </div>

      {/* Provider & Safety Inspection Grid */}
      <div className="overview-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div className="card-label" style={{ margin: 0 }}>Active Delivery Provider</div>
            <StatusBadge status="BLOCKED" label="UNSUPPORTED" />
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>
            {provider.name} ({provider.type})
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div><strong>SMTP Configured:</strong> {provider.configured ? 'YES' : 'NO'}</div>
            <div><strong>Network Capable:</strong> YES</div>
            <div><strong>Cold Commercial Outreach:</strong> <span style={{ color: '#f87171' }}>BLOCKED</span></div>
            <div><strong>Reason:</strong> OUTBOUND_PROVIDER_POLICY_UNSUPPORTED</div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div className="card-label" style={{ margin: 0 }}>SQLite Database Health</div>
            <StatusBadge status={database.status} />
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>
            SQLite WAL Mode ({Math.round(database.sizeBytes / 1024)} KB)
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div><strong>Path:</strong> <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{database.path}</span></div>
            <div><strong>Environment:</strong> {status.environment}</div>
            <div><strong>Test Data Guard:</strong> <span style={{ color: '#34d399' }}>ACTIVE (Fixtures excluded)</span></div>
          </div>
        </div>
      </div>

      {/* Acquisition Funnel Visualization */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div className="card-label" style={{ margin: 0 }}>Actual Acquisition Funnel</div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Stored campaign run and database stage progression
            </div>
          </div>
          <button className="btn btn-secondary" onClick={() => onNavigate('analytics')}>
            Full Analytics <ArrowRight size={14} />
          </button>
        </div>

        {analytics && analytics.funnel ? (
          <div className="funnel-container">
            {analytics.funnel.stages.map((stage, idx) => (
              <div key={stage.name} className="funnel-stage">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: '#64748b', fontSize: '11px', fontWeight: 700, width: '20px' }}>
                    {idx + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{stage.name}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{stage.description}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#38bdf8' }}>{stage.count}</div>
                  {idx > 0 && analytics.funnel.conversions[idx - 1] && (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {analytics.funnel.conversions[idx - 1]?.rate} from previous
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#94a3b8', padding: '20px 0', textAlign: 'center' }}>
            INSUFFICIENT DATA
          </div>
        )}
      </div>
    </div>
  );
};
