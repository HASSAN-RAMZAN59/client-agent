import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { LeadListItem, LeadDetail } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { ExternalLink, Search, X, CheckCircle2, AlertTriangle, Phone, Mail } from 'lucide-react';

export const LeadsPage: React.FC<{ selectedCampaignId?: string }> = ({ selectedCampaignId }) => {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [verifiedEmailFilter, setVerifiedEmailFilter] = useState(false);
  const [hasWebsiteFilter, setHasWebsiteFilter] = useState('');
  const [problemFilter, setProblemFilter] = useState(false);

  // Lead Detail Drawer
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    loadLeads();
  }, [
    page,
    selectedCampaignId,
    classificationFilter,
    channelFilter,
    verifiedEmailFilter,
    hasWebsiteFilter,
    problemFilter,
  ]);

  async function loadLeads() {
    try {
      setLoading(true);
      const res = await api.getLeads({
        page,
        limit: 20,
        campaignId: selectedCampaignId || undefined,
        classification: classificationFilter || undefined,
        channel: channelFilter || undefined,
        verifiedEmail: verifiedEmailFilter ? 'true' : undefined,
        hasWebsite: hasWebsiteFilter || undefined,
        hasAuditProblem: problemFilter ? 'true' : undefined,
        search: searchTerm || undefined,
      });

      setLeads(res.items);
      setTotalPages(res.pagination.totalPages || 1);
      setTotalCount(res.pagination.total || 0);
    } catch (err: any) {
      console.error('Failed to load leads', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenDetail(leadId: string) {
    try {
      setSelectedLeadId(leadId);
      setLoadingDetail(true);
      const data = await api.getLeadDetail(leadId);
      setLeadDetail(data);
    } catch (err: any) {
      console.error('Failed to fetch lead detail', err);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadLeads();
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Leads Directory</h1>
          <p className="page-subtitle">
            {totalCount} total verified local business opportunities with audit evidence
          </p>
        </div>
      </div>

      {/* Search & Multi-Filter Bar */}
      <div className="card" style={{ marginBottom: '20px', padding: '16px' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search by business name, website domain, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            <Search size={14} /> Search
          </button>
        </form>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Classification */}
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={classificationFilter}
            onChange={(e) => {
              setClassificationFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Temperatures</option>
            <option value="HOT">HOT Leads (≥70)</option>
            <option value="WARM">WARM Leads (50-69)</option>
            <option value="COLD">COLD Leads (&lt;50)</option>
          </select>

          {/* Contact Channel */}
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={channelFilter}
            onChange={(e) => {
              setChannelFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Channels</option>
            <option value="EMAIL">Email Only</option>
            <option value="PHONE">Phone Only</option>
          </select>

          {/* Website Filter */}
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={hasWebsiteFilter}
            onChange={(e) => {
              setHasWebsiteFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Website States</option>
            <option value="true">Has Website</option>
            <option value="false">Missing Website (No URL)</option>
          </select>

          {/* Verified Email Toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={verifiedEmailFilter}
              onChange={(e) => {
                setVerifiedEmailFilter(e.target.checked);
                setPage(1);
              }}
            />
            <span>Verified Email Only</span>
          </label>

          {/* Has Audit Problem Toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={problemFilter}
              onChange={(e) => {
                setProblemFilter(e.target.checked);
                setPage(1);
              }}
            />
            <span>Has Audit Findings</span>
          </label>

          {(classificationFilter || channelFilter || verifiedEmailFilter || hasWebsiteFilter || problemFilter || searchTerm) && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '4px 8px' }}
              onClick={() => {
                setClassificationFilter('');
                setChannelFilter('');
                setVerifiedEmailFilter(false);
                setHasWebsiteFilter('');
                setProblemFilter(false);
                setSearchTerm('');
                setPage(1);
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Leads Table */}
      <div className="table-container">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <div style={{ marginTop: '12px' }}>Loading leads directory...</div>
          </div>
        ) : leads.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No leads match filters</div>
            <p>Try clearing search or filter parameters.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>City</th>
                <th>Niche</th>
                <th>Website</th>
                <th>Audit Score</th>
                <th>Lead Score</th>
                <th>Class</th>
                <th>Email Contact</th>
                <th>Phone Contact</th>
                <th>Verified Problem</th>
                <th>Recommended Service</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => handleOpenDetail(l.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{l.businessName}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {l.campaignName || 'Unassigned Campaign'}
                    </div>
                  </td>
                  <td>{l.city}</td>
                  <td>{l.niche}</td>
                  <td>
                    {l.website ? (
                      <span style={{ color: '#38bdf8', fontSize: '12px' }}>
                        {l.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 24)}
                      </span>
                    ) : (
                      <span style={{ color: '#64748b' }}>None</span>
                    )}
                  </td>
                  <td>
                    {l.websiteScore !== null ? (
                      <span style={{ fontWeight: 600, color: l.websiteScore < 50 ? '#f87171' : '#fbbf24' }}>
                        {Math.round(l.websiteScore)}/100
                      </span>
                    ) : (
                      <span style={{ color: '#64748b' }}>N/A</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 700, color: '#f8fafc' }}>
                      {Math.round(l.leadScore)}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={l.leadClass} />
                  </td>
                  <td>
                    {l.email ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '12px' }}>{l.email}</span>
                        {l.isEmailVerified && (
                          <CheckCircle2 size={12} color="#34d399" title="Verified Public Email" />
                        )}
                      </div>
                    ) : (
                      <span style={{ color: '#64748b' }}>None</span>
                    )}
                  </td>
                  <td>
                    {l.phone ? (
                      <span style={{ fontSize: '12px' }}>{l.phone}</span>
                    ) : (
                      <span style={{ color: '#64748b' }}>None</span>
                    )}
                  </td>
                  <td>
                    <div style={{ maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px' }} title={l.verifiedProblem}>
                      {l.verifiedProblem}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', background: '#1e293b', padding: '2px 6px', borderRadius: '4px' }}>
                      {l.recommendedService}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Showing page {page} of {totalPages} ({totalCount} items)
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
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
        </div>
      )}

      {/* LEAD DETAIL DRAWER */}
      {selectedLeadId && (
        <div className="drawer-overlay" onClick={() => setSelectedLeadId(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">
                  {leadDetail ? leadDetail.business.name : 'Loading Lead...'}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  {leadDetail ? `${leadDetail.business.city}, ${leadDetail.business.country} — ${leadDetail.business.niche}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => setSelectedLeadId(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {loadingDetail || !leadDetail ? (
                <div className="empty-state">
                  <div className="loading-spinner"></div>
                  <div style={{ marginTop: '12px' }}>Loading detailed intelligence...</div>
                </div>
              ) : (
                <div>
                  {/* Business Identity */}
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Business Profile
                    </h4>
                    <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6 }}>
                      <div><strong>Official Name:</strong> {leadDetail.business.name}</div>
                      <div><strong>Location:</strong> {leadDetail.business.city}, {leadDetail.business.country}</div>
                      <div><strong>Website:</strong> {leadDetail.business.website || 'None'}</div>
                      <div><strong>Discovery Source:</strong> {leadDetail.business.source}</div>
                    </div>
                  </div>

                  {/* Website Audit Breakdown */}
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Website Technical Audit
                    </h4>
                    {leadDetail.audit ? (
                      <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <span style={{ fontWeight: 600 }}>Overall Quality Score:</span>
                          <span style={{ fontSize: '18px', fontWeight: 700, color: leadDetail.audit.score < 50 ? '#f87171' : '#fbbf24' }}>
                            {Math.round(leadDetail.audit.score)} / 100
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#94a3b8' }}>
                          <div>Mobile Usability: <strong>{leadDetail.audit.mobile ?? 'N/A'}</strong></div>
                          <div>Performance: <strong>{leadDetail.audit.performance ?? 'N/A'}</strong></div>
                          <div>SEO Score: <strong>{leadDetail.audit.seo ?? 'N/A'}</strong></div>
                          <div>Accessibility: <strong>{leadDetail.audit.accessibility ?? 'N/A'}</strong></div>
                          <div>Load Time: <strong>{leadDetail.audit.loadTimeMs ? `${leadDetail.audit.loadTimeMs} ms` : 'N/A'}</strong></div>
                          <div>SSL Valid: <strong>{leadDetail.audit.sslValid ? 'YES' : 'NO'}</strong></div>
                        </div>

                        {leadDetail.audit.topProblems && leadDetail.audit.topProblems.length > 0 && (
                          <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #1e293b' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                              Detected Issues:
                            </div>
                            <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#f87171' }}>
                              {leadDetail.audit.topProblems.map((prob, i) => (
                                <li key={i}>{prob}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                        No audit record found (Missing or inaccessible website).
                      </div>
                    )}
                  </div>

                  {/* Verified Public Contacts & Provenance */}
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Contact Provenance & Evidence
                    </h4>
                    {leadDetail.contacts && leadDetail.contacts.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {leadDetail.contacts.map((c) => (
                          <div key={c.id} style={{ background: '#0b0f17', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                                {c.type === 'EMAIL' ? 'Email' : 'Phone'}: {c.value}
                              </span>
                              <StatusBadge status={c.status} label={c.isVerified ? 'VERIFIED PUBLIC' : 'NOT VERIFIED'} />
                            </div>
                            {c.sourceUrl && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                <span style={{ color: '#94a3b8', fontSize: '11px' }}>Source:</span>
                                <a
                                  href={c.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 8px', fontSize: '11px' }}
                                >
                                  Open Source <ExternalLink size={10} />
                                </a>
                              </div>
                            )}
                            {c.sourceContext && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', fontStyle: 'italic' }}>
                                Context: "{c.sourceContext}"
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: '13px' }}>
                        No contact records discovered yet.
                      </div>
                    )}
                  </div>

                  {/* Lead Opportunity & Sales Angle */}
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Opportunity & Pitch Angle
                    </h4>
                    <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.6 }}>
                      <div><strong>Opportunity Score:</strong> {Math.round(leadDetail.opportunity.score)} / 100 ({leadDetail.opportunity.classification})</div>
                      <div><strong>Recommended Service:</strong> {leadDetail.opportunity.recommendedService}</div>
                      {leadDetail.opportunity.salesAngle?.reason && (
                        <div style={{ marginTop: '8px', color: '#38bdf8' }}>
                          <strong>Pitch Rationale:</strong> {leadDetail.opportunity.salesAngle.reason}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Outreach Draft History */}
                  <div>
                    <h4 style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Outreach Draft History
                    </h4>
                    {leadDetail.outreach && leadDetail.outreach.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {leadDetail.outreach.map((o) => (
                          <div key={o.id} style={{ background: '#0b0f17', padding: '12px', borderRadius: '8px', fontSize: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 600 }}>{o.variant}</span>
                              <StatusBadge status={o.status} />
                            </div>
                            <div style={{ color: '#f8fafc', fontWeight: 500, marginBottom: '4px' }}>
                              Subject: "{o.subject}"
                            </div>
                            <div style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto', background: '#131d31', padding: '8px', borderRadius: '4px' }}>
                              {o.body}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: '13px' }}>
                        No outreach drafts generated for this lead.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
