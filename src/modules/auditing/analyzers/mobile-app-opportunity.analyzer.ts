import { MobileAppOpportunityLevel } from '../../../types/index.js';

export interface MobileAppOpportunityInput {
  category: string;
  hasBooking: boolean;
  hasOrderingOrMenu: boolean;
  hasCustomerPortal: boolean;
  hasLoyaltyRewards: boolean;
  hasRecurringMembership: boolean;
  hasComplexWorkflow: boolean;
}

export interface MobileAppOpportunityResult {
  level: MobileAppOpportunityLevel;
  reasoning: string[];
}

export function analyzeMobileAppOpportunity(input: MobileAppOpportunityInput): MobileAppOpportunityResult {
  const reasoning: string[] = [];
  let score = 0;

  const highAppNiches = ['dentist', 'dental', 'doctor', 'clinic', 'restaurant', 'gym', 'fitness', 'salon', 'spa', 'pet', 'vet', 'hvac', 'plumber', 'cleaning'];
  const isHighAppNiche = highAppNiches.some((n) => input.category.toLowerCase().includes(n));

  if (isHighAppNiche) {
    score += 2;
    reasoning.push(`Industry niche ("${input.category}") benefits strongly from customer self-service, push reminders, and mobile booking.`);
  }

  if (input.hasBooking) {
    score += 3;
    reasoning.push('Business relies on appointment scheduling — prime candidate for mobile booking and automated push notification reminders.');
  }

  if (input.hasOrderingOrMenu) {
    score += 3;
    reasoning.push('Detected online ordering or interactive menu system suited for seamless mobile reordering.');
  }

  if (input.hasCustomerPortal) {
    score += 3;
    reasoning.push('Customer login/account portal present — strong case for a dedicated client mobile application.');
  }

  if (input.hasLoyaltyRewards) {
    score += 2;
    reasoning.push('Customer rewards/loyalty signals present — digital punch cards and loyalty points thrive in mobile apps.');
  }

  if (input.hasRecurringMembership) {
    score += 2;
    reasoning.push('Recurring customer membership or subscription workflow detected.');
  }

  let level: MobileAppOpportunityLevel = 'LOW';
  if (score >= 5) {
    level = 'HIGH';
  } else if (score >= 2) {
    level = 'MEDIUM';
  } else {
    reasoning.push('Business currently operates primarily as a static informational presence with limited interactive mobile app needs.');
  }

  return {
    level,
    reasoning,
  };
}
