import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { AnalyticsData } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { BarChart2, TrendingUp, AlertCircle, Clock, ShieldCheck } from 'lucide-react';

export const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.getAnalytics();
        setData(res);
      } catch (err: any) {
        console.error('Failed to load analytics', err);
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
          <div style={{ marginTop: '12px' }}>Loading analytics and conversion funnel...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-title">Failed to load analytics</div>
        </div>
      </div>
    );
  }

  const { metrics, funnel, phase12Status } = data;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Acquisition Funnel & Analytics</h1>
          <p className="page-subtitle">
            Persisted conversion metrics across all stages of discovery, qualification, review, and response
          </p>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid-cards" style={{ marginBottom: '24px' }}>
        <div className="card">
          <div className="card-label">Discovered Businesses</div>
          <div className="card-value">{metrics.totalBusinesses}</div>
          <div className="card-subtext">Initial top-of-funnel</div>
        </div>
        <div className="card">
          <div className="card-label">Qualified (HOT/WARM)</div>
          <div className="card-value" style={{ color: '#fbbf24' }}>
            {metrics.hotLeads + metrics.warmLeads}
          </div>
          <div className="card-subtext">Passed audit & scoring</div>
        </div>
        <div className="card">
          <div className="card-label">Contactable Leads</div>
          <div className="card-value" style={{ color: '#38bdf8' }}>
            {metrics.contactableLeads}
          </div>
          <div className="card-subtext">Verified public provenance</div>
        </div>
        <div className="card">
          <div className="card-label">Approved & Ready</div>
          <div className="card-value" style={{ color: '#34d399' }}>
            {metrics.approvedOutreach}
          </div>
          <div className="card-subtext">Human reviewed</div>
        </div>
        <div className="card">
          <div className="card-label">Real Sends</div>
          <div className="card-value">
            {metrics.realOutreachSent}
          </div>
          <div className="card-subtext">Live network dispatches</div>
        </div>
        <div className="card">
          <div className="card-label">Positive Prospects</div>
          <div className="card-value" style={{ color: '#34d399' }}>
            {metrics.positiveReplies}
          </div>
          <div className="card-subtext">Interested responses</div>
        </div>
      </div>

      {/* Conversion Funnel & Stage Drop-off */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '24px' }}>
        <div className="card">
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' }}>
            Full Acquisition Funnel (10 Persisted Stages)
          </h3>

          <div className="funnel-container">
            {funnel.stages.map((st, i) => (
              <div key={st.name} className="funnel-stage">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', width: '18px' }}>
                    {i + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{st.name}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{st.description}</div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#38bdf8' }}>{st.count}</div>
                  {i > 0 && funnel.conversions[i - 1] && (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {funnel.conversions[i - 1]?.rate} conversion
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Conversion Step Breakdown */}
        <div className="card">
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' }}>
            Conversion Step Rates
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {funnel.conversions.map((c) => (
              <div key={`${c.from}-${c.to}`} style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>
                  {c.from} → {c.to}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                  {c.rate}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PHASE 12 UI STATE CARD */}
      <div className="card" style={{ borderLeft: '4px solid #6366f1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
              Phase 12: {phase12Status.title}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              Automated subject/body optimization & send-time personalization engine
            </div>
          </div>
          <StatusBadge status="WARNING" label={phase12Status.status} />
        </div>

        <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6, marginBottom: '16px' }}>
          {phase12Status.explanation}
        </p>

        <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc', marginBottom: '8px' }}>
            Required Live Signal Preconditions for Optimization Activation:
          </div>
          <ul style={{ paddingLeft: '20px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.8 }}>
            {phase12Status.requiredSignals.map((sig) => (
              <li key={sig}>{sig}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
