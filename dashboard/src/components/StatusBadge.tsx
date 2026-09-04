import React from 'react';

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const norm = (status || '').toUpperCase().trim();
  let badgeClass = 'badge-healthy';
  let displayText = label || status;

  switch (norm) {
    case 'HEALTHY':
    case 'ACTIVE':
    case 'CONNECTED':
    case 'READY':
    case 'COMPLETED':
    case 'APPROVED':
    case 'READY_TO_SEND':
      badgeClass = norm === 'APPROVED' || norm === 'READY_TO_SEND' ? 'badge-approved' : 'badge-healthy';
      break;

    case 'WARNING':
    case 'REVIEW_REQUIRED':
    case 'DRAFT':
    case 'PENDING':
    case 'DEGRADED':
    case 'WARM':
      badgeClass = norm === 'WARM' ? 'badge-warm' : 'badge-warning';
      break;

    case 'BLOCKED':
    case 'UNSUPPORTED':
    case 'PROVIDER_BLOCKED':
    case 'FAILED':
    case 'REJECTED':
    case 'DISQUALIFIED':
    case 'HOT':
      badgeClass = norm === 'HOT' ? 'badge-hot' : 'badge-blocked';
      break;

    case 'DRY RUN':
    case 'DRY_RUN':
    case 'PILOT':
      badgeClass = 'badge-ready';
      break;

    case 'COLD':
      badgeClass = 'badge-cold';
      break;

    default:
      badgeClass = 'badge-ready';
      break;
  }

  return (
    <span className={`badge ${badgeClass} ${className}`} role="status" aria-label={displayText}>
      {displayText}
    </span>
  );
};
