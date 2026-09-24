import { createApp } from './app.js';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { registerSubscribers } from './services/subscribers.js';

const dbName = await initDb(config);
registerSubscribers();

createApp().listen(config.port, () => {
  console.log(`EntryLink API listening on http://localhost:${config.port}  (db: ${dbName}, env: ${config.env})`);
});
