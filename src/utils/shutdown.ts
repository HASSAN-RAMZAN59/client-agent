import { disconnectDatabase } from '../database/client.js';
import { logger } from './logger.js';

type CleanupHandler = () => Promise<void> | void;

export class GracefulShutdownManager {
  private static instance: GracefulShutdownManager;
  private handlers: Array<{ name: string; fn: CleanupHandler }> = [];
  private isShuttingDown: boolean = false;
  private log = logger.child('GracefulShutdown');

  private constructor() {
    this.registerDefaultHandlers();
  }

  public static getInstance(): GracefulShutdownManager {
    if (!GracefulShutdownManager.instance) {
      GracefulShutdownManager.instance = new GracefulShutdownManager();
    }
    return GracefulShutdownManager.instance;
  }

  public registerHandler(name: string, fn: CleanupHandler): void {
    this.handlers.push({ name, fn });
  }

  private registerDefaultHandlers(): void {
    // Default Prisma disconnect
    this.registerHandler('PrismaClient', async () => {
      await disconnectDatabase();
    });

    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      this.log.info(`Received ${signal}. Initiating graceful shutdown (outbound operations blocked)...`);

      for (const { name, fn } of this.handlers) {
        try {
          this.log.debug(`Closing resource: ${name}...`);
          await fn();
        } catch (err) {
          this.log.error(`Error during cleanup of "${name}":`, err);
        }
      }

      this.log.info('Graceful shutdown complete.');
      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }

  public getStatus(): { isShuttingDown: boolean; registeredResources: string[] } {
    return {
      isShuttingDown: this.isShuttingDown,
      registeredResources: this.handlers.map((h) => h.name),
    };
  }
}

export const shutdownManager = GracefulShutdownManager.getInstance();
