import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { PilotCandidate } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { ShieldCheck, ShieldAlert, Play, Eye, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { useCampaign } from '../context/CampaignContext.tsx';

export const PilotPage: React.FC<{
  selectedCampaignId?: string;
  onRefreshCounts?: () => void;
}> = ({ selectedCampaignId: propSelectedId, onRefreshCounts: propOnRefresh }) => {
  let context: ReturnType<typeof useCampaign> | null = null;
  try {
    context = useCampaign();
  } catch {
    context = null;
  }

  const selectedCampaignId = propSelectedId !== undefined ? propSelectedId : (context?.selectedCampaignId ?? '');
  const onRefreshCounts = propOnRefresh ?? context?.refreshNavigationSummary ?? (() => {});
  const [candidates, setCandidates] = useState<PilotCandidate[]>([]);
  const [providerPolicy, setProviderPolicy] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Pilot Preview State
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Safe Dry Run State
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [loadingDryRun, setLoadingDryRun] = useState(false);
  const [showDryRunConfirm, setShowDryRunConfirm] = useState(false);

  async function loadCandidates() {
    try {
      setLoading(true);
      const res = await api.getPilotCandidates(selectedCampaignId || undefined);
      setCandidates(res.candidates);
      setProviderPolicy(res.providerPolicy);
    } catch (err: any) {
      console.error('Failed to load pilot candidates', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCandidates();
  }, [selectedCampaignId]);

  async function handleRunPreview() {
    try {
      setLoadingPreview(true);
      setPreviewResult(null);
      const res = await api.previewPilot({
        limit: 3,
        country: 'US',
        campaignId: selectedCampaignId || undefined,
      });
      setPreviewResult(res);
      if (onRefreshCounts) onRefreshCounts();
    } catch (err: any) {
      alert(`Pilot preview failed: ${err.message}`);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleExecuteDryRun() {
    try {
      setLoadingDryRun(true);
      setShowDryRunConfirm(false);
      setDryRunResult(null);
      const res = await api.runDryRun({
        limit: 2,
        campaignId: selectedCampaignId || undefined,
      });
      setDryRunResult(res);
      await loadCandidates();
      if (onRefreshCounts) onRefreshCounts();
    } catch (err: any) {
      alert(`Dry run simulation failed: ${err.message}`);
    } finally {
      setLoadingDryRun(false);
    }
  }

  async function handleAttemptLiveSend() {
    try {
      await api.attemptLiveSend();
    } catch (err: any) {
      alert(`Server Blocked Live Send: ${err.message}`);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pilot Control Center</h1>
          <p className="page-subtitle">
            Safety-enforced dispatch gate, pilot preview diagnostics, and mock dry-run simulation
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className="btn btn-secondary"
            disabled={loadingPreview}
            onClick={handleRunPreview}
          >
            <Eye size={14} /> {loadingPreview ? 'Running Preview...' : 'Run Pilot Preview'}
          </button>
          <button
            className="btn btn-primary"
            style={{ background: '#6366f1' }}
            disabled={loadingDryRun}
            onClick={() => setShowDryRunConfirm(true)}
          >
            <Play size={14} /> {loadingDryRun ? 'Simulating...' : 'Run Safe Dry Test'}
          </button>
        </div>
      </div>

      {/* Provider Policy Alert & Live Gate */}
      <div className="card" style={{ borderLeft: '4px solid #ef4444', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
              <AlertOctagon size={18} color="#f87171" />
              LIVE SEND GATE: STRICTLY DISABLED
            </div>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px', maxWidth: '680px' }}>
              Personal Gmail SMTP is active. Under outbound delivery policy, cold commercial outreach is strictly <strong>UNSUPPORTED</strong> (OUTBOUND_PROVIDER_POLICY_UNSUPPORTED). Live outreach cannot be triggered until an approved commercial delivery provider is integrated.
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={true}
              style={{ opacity: 0.4, cursor: 'not-allowed' }}
              title="Live send blocked by provider policy"
              onClick={handleAttemptLiveSend}
            >
              Live Send (Blocked)
            </button>
            <div style={{ fontSize: '11px', color: '#f87171', marginTop: '4px' }}>
              Provider Policy: UNSUPPORTED
            </div>
          </div>
        </div>
      </div>

      {/* Pilot Preview Result Display */}
      {previewResult && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '4px solid #38bdf8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '14px' }}>
              Pilot Preview Diagnostic Report (Zero Network Sends)
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => setPreviewResult(null)}
            >
              Dismiss
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '14px' }}>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Eligible Candidates</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                {previewResult.eligibleCount}
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Blocked Candidates</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171' }}>
                {previewResult.blockedCount}
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Network Sends</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>
                {previewResult.networkSends} (Zero)
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Remaining Daily Limit</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                {previewResult.remainingDailyCapacity}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Safe Dry-Run Simulation Results */}
      {dryRunResult && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={16} color="#34d399" />
              Safe Dry-Run Simulation Succeeded (No Real Emails Sent)
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => setDryRunResult(null)}
            >
              Dismiss
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Simulated Sends</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                {dryRunResult.simulationSummary?.simulatedSends || dryRunResult.simulated || 0}
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Blocked Sends</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fbbf24' }}>
                {dryRunResult.simulationSummary?.blockedSends || dryRunResult.blocked || 0}
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Failed Sends</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171' }}>
                {dryRunResult.simulationSummary?.failedSends || dryRunResult.failed || 0}
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Network Sends</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>
                0
              </div>
            </div>
            <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Real Emails Sent</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>
                0
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approved Pilot Candidates List */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div className="card-label" style={{ margin: 0 }}>Approved Pilot Candidates</div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Human-approved drafts ready for send queue — Chapman Air & Heat & Dallas Dental Specialists
            </div>
          </div>
          <span style={{ fontSize: '13px', color: '#34d399', fontWeight: 600 }}>
            {candidates.length} Candidate(s) Approved
          </span>
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <div style={{ marginTop: '12px' }}>Loading approved pilot records...</div>
          </div>
        ) : candidates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No approved pilot candidates</div>
            <p>Approve eligible draft variants in the Review Queue to populate this list.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {candidates.map((c) => (
              <div
                key={c.outreachId}
                style={{
                  background: '#0b0f17',
                  border: '1px solid #1e293b',
                  borderRadius: '8px',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                      {c.businessName}
                    </h3>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      {c.city}, {c.country} — Niche: {c.niche} | Score: <strong>{Math.round(c.leadScore)}/100 ({c.leadClass})</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <StatusBadge status="APPROVED" label="APPROVED" />
                    <StatusBadge status="READY" label="READY_TO_SEND" />
                    <StatusBadge status="BLOCKED" label="GMAIL BLOCKED" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px', color: '#94a3b8', background: '#131d31', padding: '10px', borderRadius: '6px', marginBottom: '10px' }}>
                  <div><strong>Recipient:</strong> {c.recipientEmail} ({c.isVerifiedPublic ? 'VERIFIED_PUBLIC' : 'UNVERIFIED'})</div>
                  <div><strong>Selected Variant:</strong> {c.variant}</div>
                  <div><strong>Approved By:</strong> {c.approvedBy || 'HUMAN_OPERATOR'}</div>
                  <div><strong>Send Status:</strong> <span style={{ color: '#34d399' }}>UNSENT (sentAt: null)</span></div>
                </div>

                <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                  <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: '2px' }}>
                    Subject: "{c.subject}"
                  </div>
                  <div style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: '70px', overflowY: 'auto' }}>
                    {c.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DRY RUN CONFIRMATION MODAL */}
      {showDryRunConfirm && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div className="modal-title">Confirm Safe Dry-Run Simulation</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setShowDryRunConfirm(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <ShieldCheck size={44} color="#10b981" style={{ margin: '0 auto 10px auto' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                  THIS IS A SAFE SIMULATION
                </h3>
              </div>

              <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6, color: '#cbd5e1' }}>
                <div>• Zero real emails will be sent.</div>
                <div>• Network dispatches will remain strictly <strong>0</strong>.</div>
                <div>• Message bodies and delivery pipelines will be tested via MockOutreachProvider.</div>
                <div>• Authoritative database records will update simulated audit metrics.</div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowDryRunConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#10b981' }}
                onClick={handleExecuteDryRun}
              >
                Confirm & Run Simulation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
