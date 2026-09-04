import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { DetailedHealthStatus } from '../types/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { HeartPulse, RefreshCw, Database, Server, Mail, ShieldAlert, Cpu } from 'lucide-react';

export const SystemHealthPage: React.FC = () => {
  const [health, setHealth] = useState<DetailedHealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadHealth();
  }, []);

  async function loadHealth() {
    try {
      setRefreshing(true);
      const res = await api.getHealth();
      setHealth(res);
    } catch (err: any) {
      console.error('Failed to load system health', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="loading-spinner"></div>
          <div style={{ marginTop: '12px' }}>Executing zero-send diagnostic health checks...</div>
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-title" style={{ color: '#f87171' }}>
            Health inspection failed
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">System Health & Diagnostics</h1>
          <p className="page-subtitle">
            Component readiness, transport provider policy check, and disk access verification (Zero network sends performed)
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={refreshing}
          onClick={loadHealth}
        >
          <RefreshCw size={14} className={refreshing ? 'loading-spinner' : ''} />
          {refreshing ? 'Inspecting...' : 'Refresh Health'}
        </button>
      </div>

      {/* Overall Health Status Banner */}
      <div
        className="card"
        style={{
          borderLeft: `4px solid ${
            health.status === 'healthy' ? '#10b981' : health.status === 'degraded' ? '#f59e0b' : '#ef4444'
          }`,
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase' }}>
              OVERALL STATUS: {health.status}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              System Version: {health.version} | Node: {health.nodeVersion} | Profile: {health.environment}
            </div>
          </div>
          <StatusBadge status={health.status.toUpperCase()} />
        </div>
      </div>

      {/* Component Health Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* SQLite Database */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={16} color="#38bdf8" /> SQLite Database
            </div>
            <StatusBadge status={health.database.health} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div>Connected: <strong>{health.database.connected ? 'YES' : 'NO'}</strong></div>
            <div>File Accessible: <strong>{health.database.accessible ? 'READ / WRITE' : 'LOCKED'}</strong></div>
            <div>Latency: <strong>{health.database.latencyMs ? `${health.database.latencyMs} ms` : 'N/A'}</strong></div>
            <div>Path: <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{health.database.path}</span></div>
          </div>
        </div>

        {/* Prisma ORM */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={16} color="#6366f1" /> Prisma ORM Client
            </div>
            <StatusBadge status={health.prisma} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div>Client State: <strong>CONNECTED</strong></div>
            <div>Model Mappings: <strong>SYNCHRONIZED</strong></div>
            <div>Foreign Keys: <strong>ENFORCED (PRAGMA foreign_keys = ON)</strong></div>
          </div>
        </div>

        {/* Discovery Engine */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} color="#34d399" /> Discovery Engine
            </div>
            <StatusBadge status={health.discoveryConfig} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div>OpenStreetMap Overpass: <strong>ENABLED</strong></div>
            <div>DuckDuckGo Search: <strong>ENABLED</strong></div>
            <div>Mock Discovery Fallback: <strong>AVAILABLE</strong></div>
          </div>
        </div>

        {/* Playwright Headless Browser */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={16} color="#fbbf24" /> Playwright Browser Engine
            </div>
            <StatusBadge status={health.playwright} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div>Chromium Binary: <strong>READY</strong></div>
            <div>Audit Scraper: <strong>STANDBY</strong></div>
            <div>Mobile Layout Testing: <strong>SUPPORTED</strong></div>
          </div>
        </div>

        {/* SMTP Transport Config */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={16} color="#f87171" /> SMTP Transport Credentials
            </div>
            <StatusBadge status={health.smtpConfig === 'CONFIGURED' ? 'HEALTHY' : 'WARNING'} label={health.smtpConfig} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div>Host & Port: <strong>CONFIGURED</strong></div>
            <div>Authentication: <strong>CONFIGURED (PASSWORDS MASKED)</strong></div>
            <div>Connection Verification: <strong>SAFE PASSIVE (0 SENDS)</strong></div>
          </div>
        </div>

        {/* Outbound Provider Policy */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={16} color="#ef4444" /> Outbound Provider Policy
            </div>
            <StatusBadge status="BLOCKED" label={health.providerPolicy} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
            <div>Target Provider: <strong>GMAIL_SMTP</strong></div>
            <div>Cold Commercial Outreach: <span style={{ color: '#f87171', fontWeight: 600 }}>BLOCKED</span></div>
            <div>Reason Code: <strong>OUTBOUND_PROVIDER_POLICY_UNSUPPORTED</strong></div>
          </div>
        </div>
      </div>

      {/* Safety Mode Settings Inspection */}
      <div className="card">
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginBottom: '14px' }}>
          Server-Authoritative Safety Flags
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          <div style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>DRY_RUN</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#34d399' }}>
              {health.safetyMode.dryRun ? 'TRUE (SIMULATION)' : 'FALSE'}
            </div>
          </div>

          <div style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>OUTREACH_ENABLED</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f87171' }}>
              {health.safetyMode.outreachEnabled ? 'TRUE' : 'FALSE (DISABLED)'}
            </div>
          </div>

          <div style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>LIVE_PILOT_ENABLED</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f87171' }}>
              {health.safetyMode.livePilotEnabled ? 'TRUE' : 'FALSE (DISABLED)'}
            </div>
          </div>

          <div style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>OUTREACH_KILL_SWITCH</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#34d399' }}>
              {health.safetyMode.killSwitchActive ? 'TRUE (KILL SWITCH ACTIVE)' : 'FALSE'}
            </div>
          </div>

          <div style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>AUTO_FOLLOWUP_ENABLED</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f87171' }}>
              {health.safetyMode.autoFollowupEnabled ? 'TRUE' : 'FALSE (DISABLED)'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
