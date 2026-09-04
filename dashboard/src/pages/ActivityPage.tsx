import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { ActivityEvent } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { Activity, Clock, Filter, ShieldCheck } from 'lucide-react';

export const ActivityPage: React.FC = () => {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventType, setSelectedEventType] = useState<string>('');

  const eventTypes = [
    'ALL',
    'CAMPAIGN_CREATED',
    'CAMPAIGN_STARTED',
    'DRAFT_APPROVED',
    'DRAFT_REJECTED',
    'DRY_RUN_EXECUTED',
    'PROVIDER_POLICY_BLOCKED',
  ];

  useEffect(() => {
    loadEvents();
  }, [selectedEventType]);

  async function loadEvents() {
    try {
      setLoading(true);
      const res = await api.getActivity(
        50,
        selectedEventType === 'ALL' || !selectedEventType ? undefined : { eventType: selectedEventType }
      );
      setEvents(res.items);
    } catch (err: any) {
      console.error('Failed to load activity logs', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operator Audit Activity Log</h1>
          <p className="page-subtitle">
            Chronological audit trail of campaign operations, approvals, and safety gate enforcements (Secrets strictly redacted)
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {eventTypes.map((et) => {
          const isSelected = et === 'ALL' ? !selectedEventType : selectedEventType === et;
          return (
            <button
              key={et}
              type="button"
              className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={() => setSelectedEventType(et === 'ALL' ? '' : et)}
            >
              {et}
            </button>
          );
        })}
      </div>

      {/* Activity Feed Table */}
      <div className="table-container">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner"></div>
            <div style={{ marginTop: '12px' }}>Loading audit events...</div>
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No audit events found</div>
            <p>Actions performed via dashboard and CLI appear in this log.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Entity Target</th>
                <th>Actor</th>
                <th>Sanitized Metadata Summary</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div style={{ fontSize: '12px', color: '#f8fafc', whiteSpace: 'nowrap' }}>
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {new Date(e.timestamp).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      status={
                        e.eventType.includes('APPROVED') || e.eventType.includes('CREATED')
                          ? 'HEALTHY'
                          : e.eventType.includes('BLOCKED')
                          ? 'BLOCKED'
                          : 'READY'
                      }
                      label={e.eventType}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{e.entityType}</div>
                    {e.entityId && (
                      <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                        {e.entityId.substring(0, 12)}...
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: '12px', color: '#38bdf8' }}>{e.actor}</span>
                  </td>
                  <td>
                    {e.metadata ? (
                      <div style={{ fontSize: '12px', color: '#94a3b8', background: '#0b0f17', padding: '6px 10px', borderRadius: '4px', maxWidth: '380px', overflowX: 'auto', fontFamily: 'monospace' }}>
                        {typeof e.metadata === 'object' ? JSON.stringify(e.metadata) : String(e.metadata)}
                      </div>
                    ) : (
                      <span style={{ color: '#64748b', fontSize: '12px' }}>None</span>
                    )}
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
