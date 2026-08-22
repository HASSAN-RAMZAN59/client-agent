export interface ContactabilityInput {
  hasEmail: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  hasContactForm: boolean;
  hasAddress: boolean;
}

export interface ContactabilityResult {
  score: number;
  channelsAvailable: string[];
}

export function analyzeContactability(input: ContactabilityInput): ContactabilityResult {
  const channels: string[] = [];
  let score = 0;

  if (input.hasEmail) {
    score += 40;
    channels.push('Email');
  }

  if (input.hasPhone) {
    score += 25;
    channels.push('Phone');
  }

  if (input.hasContactForm) {
    score += 15;
    channels.push('Contact Form');
  }

  if (input.hasWebsite) {
    score += 10;
    channels.push('Website');
  }

  if (input.hasAddress) {
    score += 10;
    channels.push('Physical Location');
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    channelsAvailable: channels,
  };
}
