import { config } from '../config/env.js';

/**
 * Safe sleep function respecting safety delay bounds.
 */
export async function safeSleep(ms?: number): Promise<void> {
  const duration = ms !== undefined ? ms : config.REQUEST_DELAY_MS;
  const clampedDuration = Math.max(100, Math.min(duration, 30000));
  return new Promise((resolve) => setTimeout(resolve, clampedDuration));
}
