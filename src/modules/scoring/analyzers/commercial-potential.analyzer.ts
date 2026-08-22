export interface CommercialPotentialInput {
  category: string;
  hasPhone: boolean;
  hasAddress: boolean;
  hasBookingOrOrdering: boolean;
  hasMultiLocationOrTeam?: boolean;
}

export interface CommercialPotentialResult {
  score: number;
  reasoning: string[];
}

export function analyzeCommercialPotential(input: CommercialPotentialInput): CommercialPotentialResult {
  const reasoning: string[] = [];
  let score = 40; // Base baseline

  const catLower = input.category.toLowerCase();

  // 1. High-Ticket Client Verticals
  const tier1HighTicket = ['dentist', 'dental', 'orthodont', 'lawyer', 'attorney', 'legal', 'plastic surgery', 'cosmetic', 'roofing', 'hvac', 'plumbing', 'general contractor', 'solar', 'medical', 'clinic'];
  const tier2MidTicket = ['auto repair', 'mechanic', 'accounting', 'cpa', 'real estate', 'realtor', 'fitness', 'gym', 'veterinarian', 'pet clinic', 'salon', 'spa', 'restaurant'];

  if (tier1HighTicket.some((t) => catLower.includes(t))) {
    score += 35;
    reasoning.push(`High-ticket commercial vertical ("${input.category}") with strong client lifetime value.`);
  } else if (tier2MidTicket.some((t) => catLower.includes(t))) {
    score += 20;
    reasoning.push(`Established local service vertical ("${input.category}") with steady customer volume.`);
  } else {
    reasoning.push(`General commercial category ("${input.category}").`);
  }

  // 2. Operational Signals
  if (input.hasPhone) {
    score += 10;
    reasoning.push('Active telephone line indicates operational local business.');
  }

  if (input.hasAddress) {
    score += 5;
    reasoning.push('Physical location established.');
  }

  if (input.hasBookingOrOrdering) {
    score += 10;
    reasoning.push('Transaction/booking workflow active — direct commercial value from online conversion.');
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    reasoning,
  };
}
