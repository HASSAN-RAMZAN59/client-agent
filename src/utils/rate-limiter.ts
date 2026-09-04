import { sleep } from './sleeper.js';

export class ConcurrencyLimiter {
  private maxConcurrency: number;
  private activeCount: number = 0;
  private queue: Array<() => void> = [];

  constructor(maxConcurrency: number = 2) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}

/**
 * Ensures minimum spacing delay between successive invocations.
 */
export class PoliteRateLimiter {
  private minDelayMs: number;
  private lastExecutionTime: number = 0;

  constructor(minDelayMs: number = 1500) {
    this.minDelayMs = minDelayMs;
  }

  public async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastExecutionTime;
    if (elapsed < this.minDelayMs) {
      const waitTime = this.minDelayMs - elapsed;
      await sleep(waitTime);
    }
    this.lastExecutionTime = Date.now();
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.wait();
    return await fn();
  }
}
