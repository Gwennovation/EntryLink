import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';

const dbName = await bootstrap();

createApp().listen(config.port, () => {
  console.log(`EntryLink API listening on http://localhost:${config.port}  (db: ${dbName}, env: ${config.env})`);
});
