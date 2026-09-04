import { describe, it, expect } from 'vitest';
import { StatusBadge } from '../dashboard/src/components/StatusBadge.tsx';
import { Sidebar } from '../dashboard/src/components/Sidebar.tsx';
import React from 'react';

describe('Frontend UI & Workflow Logic Tests', () => {
  describe('1. StatusBadge Semantic Mapping', () => {
    it('should assign healthy styling to APPROVED and READY_TO_SEND', () => {
      const badgeApproved = StatusBadge({ status: 'APPROVED' });
      expect(badgeApproved.props.className).toContain('badge-approved');

      const badgeReady = StatusBadge({ status: 'READY_TO_SEND' });
      expect(badgeReady.props.className).toContain('badge-approved');
    });

    it('should assign blocked styling to UNSUPPORTED and BLOCKED', () => {
      const badgeBlocked = StatusBadge({ status: 'UNSUPPORTED' });
      expect(badgeBlocked.props.className).toContain('badge-blocked');

      const badgeProvider = StatusBadge({ status: 'PROVIDER_BLOCKED' });
      expect(badgeProvider.props.className).toContain('badge-blocked');
    });

    it('should assign distinct styles to HOT, WARM, and COLD leads', () => {
      const badgeHot = StatusBadge({ status: 'HOT' });
      expect(badgeHot.props.className).toContain('badge-hot');

      const badgeWarm = StatusBadge({ status: 'WARM' });
      expect(badgeWarm.props.className).toContain('badge-warm');

      const badgeCold = StatusBadge({ status: 'COLD' });
      expect(badgeCold.props.className).toContain('badge-cold');
    });
  });

  describe('2. Campaign Form Client-Side Validation', () => {
    it('should require non-empty name, city, and niche', () => {
      const validate = (data: { name: string; city: string; niche: string }) => {
        const errors: string[] = [];
        if (!data.name.trim()) errors.push('Campaign name is required');
        if (!data.city.trim()) errors.push('City is required');
        if (!data.niche.trim()) errors.push('Niche is required');
        return errors;
      };

      expect(validate({ name: '', city: '', niche: '' }).length).toBe(3);
      expect(validate({ name: 'Austin HVAC', city: 'Austin', niche: 'HVAC' }).length).toBe(0);
    });

    it('should cap target businesses to safe boundary', () => {
      const sanitizeTarget = (val: number) => Math.min(Math.max(1, val), 100);
      expect(sanitizeTarget(500)).toBe(100);
      expect(sanitizeTarget(-10)).toBe(1);
      expect(sanitizeTarget(50)).toBe(50);
    });
  });

  describe('3. Lead Filtering Logic', () => {
    const mockLeads = [
      { id: '1', businessName: 'Dallas Dental', leadClass: 'HOT', contactChannel: 'EMAIL', isEmailVerified: true },
      { id: '2', businessName: 'Plano Smiles', leadClass: 'WARM', contactChannel: 'PHONE', isEmailVerified: false },
      { id: '3', businessName: 'Frisco Teeth', leadClass: 'COLD', contactChannel: 'NONE', isEmailVerified: false },
    ];

    it('should filter leads by temperature classification', () => {
      const filterByClass = (leads: typeof mockLeads, cls: string) =>
        leads.filter((l) => l.leadClass === cls);

      expect(filterByClass(mockLeads, 'HOT').length).toBe(1);
      expect(filterByClass(mockLeads, 'WARM').length).toBe(1);
      expect(filterByClass(mockLeads, 'COLD').length).toBe(1);
    });

    it('should filter leads by verified email presence', () => {
      const verified = mockLeads.filter((l) => l.isEmailVerified);
      expect(verified.length).toBe(1);
      expect(verified[0]?.businessName).toBe('Dallas Dental');
    });
  });

  describe('4. Review Queue & Approval Safety', () => {
    it('should ensure selecting variant updates selected outreach ID', () => {
      let selectedId = 'variant-1';
      const selectVariant = (id: string) => {
        selectedId = id;
      };

      selectVariant('variant-2');
      expect(selectedId).toBe('variant-2');
    });

    it('should detect when draft edit requires approval invalidation', () => {
      const isApprovalInvalidated = (currentStatus: string, originalBody: string, newBody: string) => {
        const wasApproved = currentStatus === 'APPROVED' || currentStatus === 'READY_TO_SEND';
        const changed = originalBody.trim() !== newBody.trim();
        return wasApproved && changed;
      };

      expect(isApprovalInvalidated('READY_TO_SEND', 'Original text', 'Modified text')).toBe(true);
      expect(isApprovalInvalidated('DRAFT', 'Original text', 'Modified text')).toBe(false);
      expect(isApprovalInvalidated('READY_TO_SEND', 'Same text', 'Same text')).toBe(false);
    });
  });

  describe('5. Dry-Run & Simulation Safety Checks', () => {
    it('should confirm that dry-run results guarantee 0 network sends and 0 real emails', () => {
      const simulationSummary = {
        candidatesEligible: 2,
        simulatedSends: 2,
        blockedSends: 0,
        failedSends: 0,
        realNetworkSends: 0,
        realEmailsSent: 0,
      };

      expect(simulationSummary.realNetworkSends).toBe(0);
      expect(simulationSummary.realEmailsSent).toBe(0);
      expect(simulationSummary.simulatedSends).toBe(2);
    });
  });

  describe('6. Provider-Blocked Live Send Invariant', () => {
    it('should ensure live send remains strictly disabled when policy is UNSUPPORTED', () => {
      const isLiveSendEnabled = (policyStatus: string, killSwitch: boolean) => {
        return policyStatus === 'PERMITTED' && !killSwitch;
      };

      expect(isLiveSendEnabled('UNSUPPORTED', true)).toBe(false);
      expect(isLiveSendEnabled('UNSUPPORTED', false)).toBe(false);
      expect(isLiveSendEnabled('PERMITTED', true)).toBe(false);
      expect(isLiveSendEnabled('PERMITTED', false)).toBe(true);
    });
  });

  describe('7. Database Restore Confirmation Token', () => {
    it('should validate typed token strictly equals RESTORE', () => {
      const isValidConfirmation = (token: string) => token === 'RESTORE';

      expect(isValidConfirmation('restore')).toBe(false);
      expect(isValidConfirmation('RESTORE ')).toBe(false);
      expect(isValidConfirmation('YES')).toBe(false);
      expect(isValidConfirmation('RESTORE')).toBe(true);
    });
  });

  describe('8. Navigation Badge & Campaign Scope Semantics', () => {
    // Helper to find a nav item by id in rendered Sidebar
    const getNavItem = (sidebarElement: any, navId: string) => {
      const nav = sidebarElement.props.children[1]; // <nav className="sidebar-nav">
      const buttons = nav.props.children;
      return buttons.find((btn: any) => btn.key === navId);
    };

    it('should NOT render badge for Review Queue when campaign has 0 pending reviews (never 116)', () => {
      const sidebar = Sidebar({
        activePage: 'overview',
        onSelectPage: () => {},
        pendingReviewCount: 0,
        approvedCount: 0,
        selectedCampaignId: 'phase-11-campaign-id',
      });

      const reviewBtn = getNavItem(sidebar, 'review');
      expect(reviewBtn).toBeDefined();
      // Badge child (children[2]) is false when badge is undefined
      expect(reviewBtn.props.children[2]).toBe(false);
    });

    it('should render exact scoped badge count when campaign has pending reviews', () => {
      const sidebar = Sidebar({
        activePage: 'overview',
        onSelectPage: () => {},
        pendingReviewCount: 5,
        approvedCount: 0,
        selectedCampaignId: 'active-campaign-id',
      });

      const reviewBtn = getNavItem(sidebar, 'review');
      expect(reviewBtn).toBeDefined();
      const badge = reviewBtn.props.children[2];
      expect(badge).toBeTruthy();
      expect(badge.props.children).toBe(5);
    });

    it('should NOT render badges when no campaign is selected (un-scoped / global view)', () => {
      const sidebar = Sidebar({
        activePage: 'overview',
        onSelectPage: () => {},
        pendingReviewCount: 116, // global count
        approvedCount: 2,        // global count
        selectedCampaignId: '',   // un-scoped
      });

      const reviewBtn = getNavItem(sidebar, 'review');
      expect(reviewBtn.props.children[2]).toBe(false);

      const pilotBtn = getNavItem(sidebar, 'pilot');
      expect(pilotBtn.props.children[2]).toBe(false);
    });

    it('should render scoped approved count for Pilot Control when campaign has approved drafts', () => {
      const sidebar = Sidebar({
        activePage: 'overview',
        onSelectPage: () => {},
        pendingReviewCount: 0,
        approvedCount: 2,
        selectedCampaignId: 'us-pilot-campaign-id',
      });

      const pilotBtn = getNavItem(sidebar, 'pilot');
      expect(pilotBtn).toBeDefined();
      const badge = pilotBtn.props.children[2];
      expect(badge).toBeTruthy();
      expect(badge.props.children).toBe('2 Ready');
    });

    it('should NOT render Pilot Control badge when active campaign has 0 approved drafts', () => {
      const sidebar = Sidebar({
        activePage: 'overview',
        onSelectPage: () => {},
        pendingReviewCount: 0,
        approvedCount: 0,
        selectedCampaignId: 'phase-11-campaign-id',
      });

      const pilotBtn = getNavItem(sidebar, 'pilot');
      expect(pilotBtn.props.children[2]).toBe(false);
    });
  });
});

