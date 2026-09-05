import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { CampaignSummary, ReviewBusinessGroup, PilotReviewItemVariant } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { Check, X, Edit3, SkipForward, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';
import { useCampaign } from '../context/CampaignContext.tsx';

export const ReviewQueuePage: React.FC<{
  campaigns?: CampaignSummary[];
  selectedCampaignId?: string;
  onSelectCampaign?: (id: string) => void;
  onRefreshCounts?: () => void;
}> = ({
  campaigns: propCampaigns,
  selectedCampaignId: propSelectedId,
  onSelectCampaign: propOnSelect,
  onRefreshCounts: propOnRefresh,
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
  const onRefreshCounts = propOnRefresh ?? context?.refreshNavigationSummary ?? (() => {});
  const [groups, setGroups] = useState<ReviewBusinessGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Selected variant per card
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Edit Modal State
  const [editingVariant, setEditingVariant] = useState<PilotReviewItemVariant | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editNotice, setEditNotice] = useState<string | null>(null);

  // Reject Reason Modal State
  const [rejectingBusinessId, setRejectingBusinessId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('Manual operator rejection');

  // Approval Feedback State
  const [approvalResult, setApprovalResult] = useState<any | null>(null);

  useEffect(() => {
    if (selectedCampaignId) {
      loadQueue(selectedCampaignId);
    } else {
      setGroups([]);
    }
  }, [selectedCampaignId]);

  async function loadQueue(campaignId: string) {
    try {
      setLoading(true);
      setError(null);
      setApprovalResult(null);
      setCurrentIndex(0);
      const res = await api.getReviewQueue(campaignId, 50);
      setGroups(res.items);
      if (res.items.length > 0 && res.items[0]?.variants?.length) {
        setSelectedVariantId(res.items[0].variants[0]?.outreachId || null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }

  const currentGroup = groups[currentIndex];

  useEffect(() => {
    if (currentGroup && currentGroup.variants.length > 0) {
      setSelectedVariantId(currentGroup.variants[0]?.outreachId || null);
    }
  }, [currentIndex, currentGroup]);

  async function handleApprove() {
    if (!selectedVariantId) {
      alert('Please select a message variant to approve.');
      return;
    }

    try {
      const res = await api.approveDraft(selectedVariantId, 'HUMAN_OPERATOR');
      setApprovalResult(res);
      if (onRefreshCounts) onRefreshCounts();

      // Advance to next after approval
      setTimeout(() => {
        setApprovalResult(null);
        if (currentIndex < groups.length - 1) {
          setCurrentIndex((idx) => idx + 1);
        } else {
          // Finished batch, reload
          loadQueue(selectedCampaignId);
        }
      }, 1500);
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    }
  }

  async function handleRejectSubmit() {
    if (!rejectingBusinessId) return;

    try {
      await api.rejectBusiness(rejectingBusinessId, rejectReason, 'HUMAN_OPERATOR');
      setRejectingBusinessId(null);
      if (onRefreshCounts) onRefreshCounts();
      if (currentIndex < groups.length - 1) {
        setCurrentIndex((idx) => idx + 1);
      } else {
        loadQueue(selectedCampaignId);
      }
    } catch (err: any) {
      alert(`Rejection failed: ${err.message}`);
    }
  }

  function handleOpenEdit(v: PilotReviewItemVariant) {
    setEditingVariant(v);
    setEditSubject(v.subject);
    setEditBody(v.body);
    setEditNotice(
      v.status === 'APPROVED' || v.status === 'READY_TO_SEND'
        ? 'CONTENT_CHANGED_AFTER_APPROVAL: Modifying this draft will invalidate prior approval and require explicit re-approval.'
        : null
    );
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingVariant) return;

    try {
      await api.editDraft(editingVariant.outreachId, {
        subject: editSubject,
        body: editBody,
      });

      // Update variant in current state
      if (currentGroup) {
        const updatedVariants = currentGroup.variants.map((v) =>
          v.outreachId === editingVariant.outreachId
            ? { ...v, subject: editSubject, body: editBody, status: 'REVIEW_REQUIRED' }
            : v
        );
        currentGroup.variants = updatedVariants;
      }

      setEditingVariant(null);
    } catch (err: any) {
      alert(`Failed to save draft edits: ${err.message}`);
    }
  }

  function handleSkip() {
    if (currentIndex < groups.length - 1) {
      setCurrentIndex((idx) => idx + 1);
    } else {
      setCurrentIndex(0);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Human Review Queue</h1>
          <p className="page-subtitle">
            1-Business = 1-Review Card — Inspect evidence, select 1 approved variant, or edit and approve
          </p>
        </div>

        {/* Campaign Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label htmlFor="review-campaign-select" style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>
            Target Campaign:
          </label>
          <select
            id="review-campaign-select"
            className="form-select"
            style={{ width: '260px' }}
            value={selectedCampaignId}
            onChange={(e) => onSelectCampaign(e.target.value)}
          >
            <option value="">
              {campaigns.length === 0 ? 'No Active Campaign' : '-- Select Campaign Required --'}
            </option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.city}, {c.niche})
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedCampaignId ? (
        <div className="card empty-state">
          <div className="empty-state-title">Campaign Selection Required</div>
          <p>Please select a campaign from the dropdown above to load its pending review queue.</p>
        </div>
      ) : loading ? (
        <div className="card empty-state">
          <div className="loading-spinner"></div>
          <div style={{ marginTop: '12px' }}>Loading eligible review candidates...</div>
        </div>
      ) : error ? (
        <div className="card empty-state">
          <div className="empty-state-title" style={{ color: '#f87171' }}>
            Failed to load review queue
          </div>
          <p>{error}</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-title">Zero Pending Review Items</div>
          <p>All high-confidence candidate drafts for this campaign have been reviewed or approved.</p>
        </div>
      ) : (
        <div>
          {/* Progress Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>
              Candidate {currentIndex + 1} of {groups.length} in Queue
            </span>
            <button className="btn btn-secondary" onClick={handleSkip}>
              <SkipForward size={14} /> Skip Business
            </button>
          </div>

          {/* Review Card */}
          <div className="review-card">
            {/* Business Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1e293b', paddingBottom: '16px', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>
                  {currentGroup.businessName}
                </h2>
                <div style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span>Location: <strong>{currentGroup.location}</strong></span>
                  <span>Niche: <strong>{currentGroup.niche}</strong></span>
                  <span>Website: <strong>{currentGroup.website}</strong></span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <StatusBadge status={currentGroup.classification} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', background: '#1e293b', padding: '4px 10px', borderRadius: '6px' }}>
                  Score: {Math.round(currentGroup.leadScore)}/100
                </span>
              </div>
            </div>

            {/* Recipient & Contact Provenance */}
            <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', lineHeight: 1.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Verified Recipient:</strong>{' '}
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>{currentGroup.recipientEmail}</span>{' '}
                  <StatusBadge status="APPROVED" label="VERIFIED PUBLIC" />
                </div>
                {currentGroup.provenance?.sourceUrl && (
                  <a
                    href={currentGroup.provenance.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                  >
                    Open Source Evidence <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <div style={{ marginTop: '6px', color: '#94a3b8' }}>
                <strong>Audit Evidence:</strong> {currentGroup.problem}
              </div>
              <div style={{ color: '#94a3b8' }}>
                <strong>Recommended Service:</strong> {currentGroup.recommendedService}
              </div>
            </div>

            {/* 3 Variants */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px' }}>
                Available Outreach Variants (Select 1 to Approve)
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {currentGroup.variants.map((v) => {
                  const isSelected = selectedVariantId === v.outreachId;
                  return (
                    <div
                      key={v.outreachId}
                      className={`variant-box ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedVariantId(v.outreachId)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="radio"
                            name="selectedVariant"
                            checked={isSelected}
                            onChange={() => setSelectedVariantId(v.outreachId)}
                          />
                          <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '14px' }}>
                            {v.variantLabel}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            Quality: <strong>{Math.round(v.qualityScore)}/100</strong> ({v.qualityBand})
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(v);
                            }}
                          >
                            <Edit3 size={11} /> Edit Draft
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8', marginBottom: '6px' }}>
                        Subject: "{v.subject}"
                      </div>

                      <div style={{ fontSize: '12px', color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.6, background: '#131d31', padding: '12px', borderRadius: '6px' }}>
                        {v.body}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Approval Notification */}
            {approvalResult && (
              <div style={{ marginTop: '20px', padding: '14px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '8px', color: '#34d399', fontSize: '13px' }}>
                <strong>✓ Variant Approved & Ready to Send!</strong>
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#cbd5e1' }}>
                  Selected variant set to READY_TO_SEND. {approvalResult.archivedCount} other variant(s) archived from queue.
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #1e293b' }}>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setRejectingBusinessId(currentGroup.businessId)}
              >
                <X size={14} /> Reject Business
              </button>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={handleSkip}>
                  Skip for Now
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: '#10b981' }}
                  onClick={handleApprove}
                >
                  <Check size={16} /> Approve Selected Variant
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT DRAFT MODAL */}
      {editingVariant && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">Edit Draft Content ({editingVariant.variantLabel})</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setEditingVariant(null)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="modal-body">
                {editNotice && (
                  <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)', padding: '10px 14px', borderRadius: '6px', color: '#fbbf24', fontSize: '12px', marginBottom: '16px' }}>
                    {editNotice}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Subject Line *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Message Body *</label>
                  <textarea
                    className="form-textarea"
                    style={{ minHeight: '200px' }}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingVariant(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectingBusinessId && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <div className="modal-title">Reject Business & Archive Drafts</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setRejectingBusinessId(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
                All generated drafts for this business will be marked REJECTED and permanently removed from the send queue.
              </p>

              <div className="form-group">
                <label className="form-label">Rejection Reason</label>
                <select
                  className="form-select"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                >
                  <option value="Manual operator rejection">Manual operator rejection</option>
                  <option value="Poor problem fit">Poor problem fit / Weak audit angle</option>
                  <option value="Unsatisfactory contact confidence">Unsatisfactory contact confidence</option>
                  <option value="Competitor or corporate entity">Competitor or corporate entity</option>
                  <option value="Outside service territory">Outside service territory</option>
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setRejectingBusinessId(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleRejectSubmit}>
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
