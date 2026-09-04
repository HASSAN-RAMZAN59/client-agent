import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { ReplyItem } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { MessageSquare, ThumbsUp, HelpCircle, UserX, Clock } from 'lucide-react';

export const RepliesPage: React.FC = () => {
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClassification, setSelectedClassification] = useState<string>('');

  const classifications = [
    'ALL',
    'POSITIVE',
    'QUESTION',
    'NEGATIVE',
    'NOT_INTERESTED',
    'UNSUBSCRIBE',
    'OUT_OF_OFFICE',
    'UNKNOWN',
  ];

  useEffect(() => {
    loadReplies();
  }, [selectedClassification]);

  async function loadReplies() {
    try {
      setLoading(true);
      const res = await api.getReplies(
        selectedClassification === 'ALL' || !selectedClassification ? undefined : selectedClassification
      );
      setReplies(res.items);
    } catch (err: any) {
      console.error('Failed to load replies', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inbound Replies</h1>
          <p className="page-subtitle">
            Categorized incoming communications, sentiment classification, and suppression triggers (No automated auto-replies)
          </p>
        </div>
      </div>

      {/* Classification Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {classifications.map((c) => {
          const isSelected =
            c === 'ALL' ? !selectedClassification : selectedClassification === c;
          return (
            <button
              key={c}
              type="button"
              className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '12px', padding: '6px 12px' }}
              onClick={() => setSelectedClassification(c === 'ALL' ? '' : c)}
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* Replies Table */}
      <div className="table-container">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <div style={{ marginTop: '12px' }}>Loading replies feed...</div>
          </div>
        ) : replies.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No replies recorded</div>
            <p>Inbound replies from active outreach sequences will be categorized here.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Business Name</th>
                <th>Sender</th>
                <th>Campaign</th>
                <th>Received At</th>
                <th>Classification</th>
                <th>Sentiment</th>
                <th>Suppression Status</th>
                <th>Message Snippet</th>
              </tr>
            </thead>
            <tbody>
              {replies.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    background: r.isPositive
                      ? 'rgba(16, 185, 129, 0.05)'
                      : r.isQuestion
                      ? 'rgba(56, 189, 248, 0.05)'
                      : undefined,
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{r.businessName}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: '12px', color: '#38bdf8' }}>{r.senderEmail}</span>
                  </td>
                  <td>{r.campaignName}</td>
                  <td>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      {new Date(r.receivedAt).toLocaleString()}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {r.isPositive && <ThumbsUp size={14} color="#34d399" />}
                      {r.isQuestion && <HelpCircle size={14} color="#38bdf8" />}
                      {r.isUnsubscribe && <UserX size={14} color="#f87171" />}
                      <StatusBadge
                        status={
                          r.isPositive ? 'HEALTHY' : r.isUnsubscribe ? 'BLOCKED' : 'WARNING'
                        }
                        label={r.classification}
                      />
                    </div>
                  </td>
                  <td>{r.sentiment}</td>
                  <td>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: r.suppressionStatus.includes('SUPPRESSED') ? '#f87171' : '#34d399',
                      }}
                    >
                      {r.suppressionStatus}
                    </span>
                  </td>
                  <td>
                    <div style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', color: '#94a3b8' }} title={r.body || ''}>
                      {r.body || 'No text snippet available'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
