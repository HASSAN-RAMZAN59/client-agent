import React from 'react';
import {
  LayoutDashboard,
  Target,
  Users,
  CheckSquare,
  Send,
  PhoneCall,
  MessageSquare,
  BarChart3,
  Activity,
  HeartPulse,
  Settings,
} from 'lucide-react';

export type PageId =
  | 'overview'
  | 'campaigns'
  | 'leads'
  | 'review'
  | 'pilot'
  | 'phone-leads'
  | 'replies'
  | 'analytics'
  | 'activity'
  | 'health'
  | 'settings';

interface SidebarProps {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  pendingReviewCount?: number;
  approvedCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  pendingReviewCount = 0,
  approvedCount = 0,
}) => {
  const navItems = [
    { id: 'overview' as PageId, label: 'Overview', icon: LayoutDashboard },
    { id: 'campaigns' as PageId, label: 'Campaigns', icon: Target },
    { id: 'leads' as PageId, label: 'Leads', icon: Users },
    {
      id: 'review' as PageId,
      label: 'Review Queue',
      icon: CheckSquare,
      badge: pendingReviewCount > 0 ? pendingReviewCount : undefined,
    },
    {
      id: 'pilot' as PageId,
      label: 'Pilot Control',
      icon: Send,
      badge: approvedCount > 0 ? `${approvedCount} Ready` : undefined,
    },
    { id: 'phone-leads' as PageId, label: 'Phone Leads', icon: PhoneCall },
    { id: 'replies' as PageId, label: 'Replies', icon: MessageSquare },
    { id: 'analytics' as PageId, label: 'Analytics', icon: BarChart3 },
    { id: 'activity' as PageId, label: 'Activity Log', icon: Activity },
    { id: 'health' as PageId, label: 'System Health', icon: HeartPulse },
    { id: 'settings' as PageId, label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar" aria-label="Main Navigation">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span>OPERATOR OS</span>
          <span className="sidebar-logo-badge">LOCAL</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectPage(item.id)}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={16} className="nav-item-icon" />
              <span className="nav-item-label">{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`nav-item-badge ${
                    item.id === 'review' ? 'badge-review' : item.id === 'pilot' ? 'badge-pilot' : ''
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div>Single-User Mode</div>
        <div style={{ color: '#475569', fontSize: '11px', marginTop: '2px' }}>
          Strict Safety Active
        </div>
      </div>
    </aside>
  );
};
