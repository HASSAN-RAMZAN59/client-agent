import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { PhoneLead } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { Phone, CheckCircle, FileText, X } from 'lucide-react';

export const PhoneLeadsPage: React.FC = () => {
  const [leads, setLeads] = useState<PhoneLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Note Modal State
  const [activeLeadForNote, setActiveLeadForNote] = useState<PhoneLead | null>(null);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    loadPhoneLeads();
  }, [page]);

  async function loadPhoneLeads() {
    try {
      setLoading(true);
      const res = await api.getPhoneLeads(page, 20);
      setLeads(res.items);
      setTotalPages(res.pagination.totalPages || 1);
    } catch (err: any) {
      console.error('Failed to load phone leads', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleContacted(lead: PhoneLead) {
    try {
      const nextStatus = lead.status === 'CONTACTED' ? 'NEW' : 'CONTACTED';
      await api.markPhoneContacted(lead.leadId, nextStatus);
      setLeads((prev) =>
        prev.map((l) => (l.leadId === lead.leadId ? { ...l, status: nextStatus } : l))
      );
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  }

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!activeLeadForNote || !noteText.trim()) return;

    try {
      await api.addPhoneNote(activeLeadForNote.leadId, noteText.trim());
      setNoteText('');
      setActiveLeadForNote(null);
      await loadPhoneLeads();
    } catch (err: any) {
      alert(`Failed to save note: ${err.message}`);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Phone Leads Queue</h1>
          <p className="page-subtitle">
            Manual telephone outreach queue with verified problems and call objectives (No automated dialing/SMS)
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '20px', background: 'rgba(30, 41, 59, 0.4)', padding: '14px 18px' }}>
        <div style={{ fontSize: '13px', color: '#94a3b8' }}>
          ℹ️ <strong>Operator Notice:</strong> Automated dialing, SMS, and WhatsApp bots are strictly blocked. All telephone calls and conversations are performed manually by human operators.
        </div>
      </div>

      {/* Phone Leads Table */}
      <div className="table-container">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <div style={{ marginTop: '12px' }}>Loading phone leads queue...</div>
          </div>
        ) : leads.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No phone leads available</div>
            <p>Run a campaign discovery to populate local business phone contacts.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Phone Number</th>
                <th>Location</th>
                <th>Niche</th>
                <th>Lead Score</th>
                <th>Website</th>
                <th>Verified Problem</th>
                <th>Call Objective</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.leadId}>
                  <td>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{l.businessName}</div>
                    {l.notes && (
                      <div style={{ fontSize: '11px', color: '#38bdf8', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.notes}>
                        Note: {l.notes}
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#34d399' }}>
                      {l.phone}
                    </span>
                  </td>
                  <td>{l.city}, {l.country}</td>
                  <td>{l.niche}</td>
                  <td>
                    <span style={{ fontWeight: 700 }}>{Math.round(l.leadScore)}/100</span>
                  </td>
                  <td>
                    {l.website !== 'None' ? (
                      <span style={{ color: '#38bdf8', fontSize: '12px' }}>
                        {l.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 20)}
                      </span>
                    ) : (
                      <span style={{ color: '#64748b' }}>None</span>
                    )}
                  </td>
                  <td>
                    <div style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }} title={l.verifiedProblem}>
                      {l.verifiedProblem}
                    </div>
                  </td>
                  <td>
                    <div style={{ maxWidth: '180px', fontSize: '12px', color: '#cbd5e1' }} title={l.callObjective}>
                      {l.callObjective}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={l.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => handleToggleContacted(l)}
                      >
                        {l.status === 'CONTACTED' ? 'Mark New' : 'Mark Called'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => {
                          setActiveLeadForNote(l);
                          setNoteText('');
                        }}
                      >
                        <FileText size={11} /> Note
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}

      {/* Add Note Modal */}
      {activeLeadForNote && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div className="modal-title">Call Notes: {activeLeadForNote.businessName}</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setActiveLeadForNote(null)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveNote}>
              <div className="modal-body">
                <div style={{ marginBottom: '12px', fontSize: '13px', color: '#94a3b8' }}>
                  Phone: <strong>{activeLeadForNote.phone}</strong> | Objective: {activeLeadForNote.callObjective}
                </div>

                {activeLeadForNote.notes && (
                  <div style={{ background: '#0b0f17', padding: '10px', borderRadius: '6px', fontSize: '12px', color: '#cbd5e1', marginBottom: '14px', maxHeight: '100px', overflowY: 'auto' }}>
                    <strong>Prior History:</strong>
                    <div style={{ whiteSpace: 'pre-wrap', marginTop: '4px' }}>{activeLeadForNote.notes}</div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">New Call Log Entry *</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Spoke with receptionist, owner available on Tuesday 2 PM..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setActiveLeadForNote(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Call Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
