import http from 'http';
import { exec } from 'child_process';
import { createApp } from '../src/api/server.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child('DashboardLauncher');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

async function main() {
  console.log('======================================================================');
  console.log('🚀 STARTING FINAL LOCAL OPERATOR DASHBOARD');
  console.log('======================================================================');
  console.log(`• Binding: http://${HOST}:${PORT}`);
  console.log('• Single-User Mode: Local operator access only');
  console.log('• Zero-Send Policy: DRY_RUN=true, OUTREACH_ENABLED=false');
  console.log('======================================================================\n');

  const app = createApp();
  const server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`\n✔ OPERATOR DASHBOARD IS READY AT: ${url}\n`);

    // Automatically launch browser on host OS
    const openCommand =
      process.platform === 'win32'
        ? `start ${url}`
        : process.platform === 'darwin'
        ? `open ${url}`
        : `xdg-open ${url}`;

    exec(openCommand, (err) => {
      if (err) {
        log.debug('Could not auto-launch browser (browser may already be open)', { error: err.message });
      } else {
        console.log(`✔ Default browser launched to ${url}`);
      }
    });
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\nStopping operator dashboard server...');
    server.close(() => {
      console.log('Dashboard stopped gracefully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error starting dashboard:', err);
  process.exit(1);
});
