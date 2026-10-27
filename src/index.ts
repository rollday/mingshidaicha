import { config } from './config.ts';
import { createBackend } from './server.ts';

const backend = await createBackend();
backend.server.listen(config.port, config.host, () => {
  const address = backend.server.address();
  console.log(JSON.stringify({ event: 'server.started', host: config.host, port: address && typeof address === 'object' ? address.port : config.port, model: config.model }));
});
backend.server.on('error', error => { console.error(JSON.stringify({ event: 'server.start_failed', code: 'code' in error ? error.code : 'UNKNOWN' })); void backend.close().then(() => process.exit(1)); });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void backend.close().then(() => process.exit(0));
});
