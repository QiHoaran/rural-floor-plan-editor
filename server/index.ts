import { createServerConfig } from './config.js';
import { createApp } from './app.js';

const config = createServerConfig();
const app = await createApp(config);
const server = app.listen(config.port, () => {
  console.log(`Rural floor plan editor: http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
