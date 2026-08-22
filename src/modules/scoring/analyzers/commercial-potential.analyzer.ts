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
  const tier1HighTicket = [
    'dentist', 'dental', 'orthodont', 'lawyer', 'attorney', 'legal', 'law firm',
    'plastic surgery', 'cosmetic', 'roofing', 'hvac', 'plumbing', 'plumber',
    'general contractor', 'solar', 'medical', 'clinic', 'auto dealership',
    'car dealership', 'dealership', 'software', 'it agency', 'agency',
    'real estate', 'realtor'
  ];
  const tier2MidTicket = [
    'auto repair', 'mechanic', 'accounting', 'cpa', 'fitness', 'gym',
    'veterinarian', 'pet clinic', 'salon', 'barbershop', 'barber', 'spa',
    'restaurant', 'cafe', 'cleaning', 'cleaner', 'cleaning company'
  ];

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
