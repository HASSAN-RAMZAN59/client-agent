import React, { useEffect, useState } from 'react';
import { api } from '../services/api.ts';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { Database, ShieldCheck, Download, Upload, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<any | null>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Backup Action State
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState<any | null>(null);

  // Restore Modal State
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<string | null>(null);
  const [restoreConfirmInput, setRestoreConfirmInput] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<any | null>(null);

  useEffect(() => {
    loadSettingsAndBackups();
  }, []);

  async function loadSettingsAndBackups() {
    try {
      setLoading(true);
      const [sData, bData] = await Promise.all([api.getSettings(), api.getBackups()]);
      setSettings(sData);
      setBackups(bData);
    } catch (err: any) {
      console.error('Failed to load settings', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBackup() {
    try {
      setCreatingBackup(true);
      setBackupSuccess(null);
      const res = await api.createBackup();
      setBackupSuccess(res);
      await loadSettingsAndBackups();
    } catch (err: any) {
      alert(`Backup creation failed: ${err.message}`);
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handleExecuteRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBackupForRestore) return;
    if (restoreConfirmInput !== 'RESTORE') {
      alert('You must type RESTORE exactly to confirm database restoration.');
      return;
    }

    try {
      setRestoring(true);
      const res = await api.restoreBackup(selectedBackupForRestore, 'RESTORE');
      setRestoreSuccess(res);
      setSelectedBackupForRestore(null);
      setRestoreConfirmInput('');
      await loadSettingsAndBackups();
    } catch (err: any) {
      alert(`Database restore failed: ${err.message}`);
    } finally {
      setRestoring(false);
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="loading-spinner"></div>
          <div style={{ marginTop: '12px' }}>Loading configuration and backup records...</div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-title">Failed to load configuration</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings & Database Management</h1>
          <p className="page-subtitle">
            Local SQLite atomic backups, safe restore utilities, and secret-masked environment configuration
          </p>
        </div>
      </div>

      {/* Database Backup & Restore Panel */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
              Zero-Cost Database Backups & Snapshots
            </h2>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Create timestamped atomic SQLite backups in backend-controlled backups/ directory
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={creatingBackup}
            onClick={handleCreateBackup}
          >
            <Download size={14} /> {creatingBackup ? 'Creating Snapshot...' : 'Create Backup'}
          </button>
        </div>

        {backupSuccess && (
          <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '14px', marginBottom: '16px', color: '#34d399', fontSize: '13px', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} /> Backup Created Successfully
            </div>
            <div><strong>Filename:</strong> {backupSuccess.filename}</div>
            <div><strong>SHA-256 Checksum:</strong> <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{backupSuccess.checksum}</span></div>
            <div><strong>Size:</strong> {Math.round(backupSuccess.sizeBytes / 1024)} KB</div>
          </div>
        )}

        {restoreSuccess && (
          <div style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '8px', padding: '14px', marginBottom: '16px', color: '#38bdf8', fontSize: '13px', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>✓ Database Restored Successfully</div>
            <div><strong>Restored From:</strong> {restoreSuccess.restoredFrom}</div>
            <div><strong>Pre-Restore Safety Snapshot Created:</strong> {restoreSuccess.preRestoreBackup}</div>
          </div>
        )}

        {/* Existing Backups Table */}
        <div style={{ marginTop: '12px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '10px' }}>
            Available Backup Archives ({backups.length})
          </h3>

          {backups.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '13px', padding: '12px 0' }}>
              No previous backups found in backups/ directory. Click "Create Backup" to generate one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {backups.map((b) => (
                <div
                  key={b.filename}
                  style={{
                    background: '#0b0f17',
                    border: '1px solid #1e293b',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>
                      {b.filename}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', gap: '12px' }}>
                      <span>Size: {Math.round(b.sizeBytes / 1024)} KB</span>
                      <span>Created: {new Date(b.createdAt).toLocaleString()}</span>
                      <span style={{ fontFamily: 'monospace' }}>SHA: {b.checksum.substring(0, 12)}...</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 10px', color: '#f87171' }}
                    onClick={() => {
                      setSelectedBackupForRestore(b.filename);
                      setRestoreConfirmInput('');
                    }}
                  >
                    <Upload size={12} /> Restore Snapshot
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Provider Policy & Future Providers Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>
          Delivery Providers & Commercial Outreach Policies
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
          Context-aware email transport routing. Providers must be explicitly approved before live commercial dispatch is unlocked.
        </p>

        {/* Active Provider */}
        <div style={{ background: '#0b0f17', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '14px' }}>
                {settings.provider.active.name} ({settings.provider.active.type})
              </span>
              <span style={{ fontSize: '11px', color: '#38bdf8', marginLeft: '10px' }}>[CURRENT ACTIVE]</span>
            </div>
            <StatusBadge status="BLOCKED" label={settings.provider.active.policyStatus} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#94a3b8' }}>
            <div>SMTP Host: <strong>{settings.provider.active.smtpHost}</strong></div>
            <div>SMTP Port: <strong>{settings.provider.active.smtpPort}</strong></div>
            <div>Credentials: <strong>{settings.provider.active.smtpUser} / {settings.provider.active.smtpPasswordState}</strong></div>
            <div>Personal Gmail Detected: <strong>{settings.provider.active.isPersonalGmail ? 'YES' : 'NO'}</strong></div>
            <div>Cold Commercial Outreach: <strong style={{ color: '#f87171' }}>UNSUPPORTED</strong></div>
            <div>Reason: <strong>{settings.provider.active.reason}</strong></div>
          </div>
        </div>

        {/* Future Providers (Requirement 23) */}
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '10px' }}>
          Future Provider Integration Slots
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {settings.provider.futureProviders.map((fp: any) => (
            <div key={fp.name} style={{ background: '#0b0f17', border: '1px solid #1e293b', borderRadius: '8px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#cbd5e1', fontSize: '13px' }}>
                  {fp.name} ({fp.type})
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  {fp.note}
                </div>
              </div>
              <StatusBadge status="WARNING" label={fp.policyStatus} />
            </div>
          ))}
        </div>
      </div>

      {/* Safety & Environment Information (Secrets Masked) */}
      <div className="card">
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' }}>
          Environment Configuration & Safety Flags
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '12px', lineHeight: 1.8, color: '#94a3b8' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>Application Profile</div>
            <div>Environment: <strong>{settings.general.environment}</strong></div>
            <div>System Mode: <strong>{settings.general.mode}</strong></div>
            <div>Database Provider: <strong>{settings.database.provider} (WAL Mode)</strong></div>
            <div>Database Path: <span style={{ fontFamily: 'monospace' }}>{settings.database.path}</span></div>
          </div>

          <div style={{ background: '#0b0f17', padding: '14px', borderRadius: '8px', fontSize: '12px', lineHeight: 1.8, color: '#94a3b8' }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>Authoritative Safety Limits</div>
            <div>DRY_RUN: <strong style={{ color: '#34d399' }}>{settings.safety.dryRun ? 'TRUE' : 'FALSE'}</strong></div>
            <div>OUTREACH_ENABLED: <strong style={{ color: '#f87171' }}>{settings.safety.outreachEnabled ? 'TRUE' : 'FALSE'}</strong></div>
            <div>OUTREACH_KILL_SWITCH: <strong style={{ color: '#34d399' }}>{settings.safety.outreachKillSwitch ? 'TRUE' : 'FALSE'}</strong></div>
            <div>Max Pilot Sends / Run: <strong>{settings.safety.maxSendsPerRun}</strong></div>
            <div>Max Pilot Sends / Day: <strong>{settings.safety.maxSendsPerDay}</strong></div>
          </div>
        </div>
      </div>

      {/* RESTORE CONFIRMATION MODAL */}
      {selectedBackupForRestore && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: '#f87171' }}>
                Confirm Database Restore
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px' }}
                onClick={() => {
                  setSelectedBackupForRestore(null);
                  setRestoreConfirmInput('');
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteRestore}>
              <div className="modal-body">
                <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                  <AlertTriangle size={40} color="#f87171" style={{ margin: '0 auto 8px auto' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                    DANGER: RESTORING WILL OVERWRITE ACTIVE DATABASE
                  </h3>
                </div>

                <div style={{ background: '#0b0f17', padding: '12px', borderRadius: '6px', fontSize: '12px', color: '#cbd5e1', lineHeight: 1.6, marginBottom: '16px' }}>
                  <div>• Selected archive: <strong>{selectedBackupForRestore}</strong></div>
                  <div>• An automatic pre-restore safety snapshot will be taken before restoring.</div>
                  <div>• To prevent accidental data loss, you must explicitly type <strong>RESTORE</strong> below.</div>
                </div>

                <div className="form-group">
                  <label className="form-label">Type "RESTORE" to confirm *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="RESTORE"
                    value={restoreConfirmInput}
                    onChange={(e) => setRestoreConfirmInput(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={restoring}
                  onClick={() => {
                    setSelectedBackupForRestore(null);
                    setRestoreConfirmInput('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={restoring || restoreConfirmInput !== 'RESTORE'}
                >
                  {restoring ? 'Restoring...' : 'Execute Database Restore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
