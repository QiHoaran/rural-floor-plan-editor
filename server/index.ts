import { createServerConfig } from './config.js';
import { createApp } from './app.js';

const config = createServerConfig();
const app = await createApp(config);
const server = app.listen(config.port, () => {
  console.log(`Rural floor plan editor: http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(0), 250);
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
  server.closeAllConnections();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, shutdown);
}

if (process.env.EXIT_WITH_PARENT === '1') {
  const parentPid = process.ppid;
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      shutdown();
    }
  }, 250).unref();
}
