import { buildServer } from './server';
import { dataDir } from './storage';

const PORT = Number(process.env.PORT ?? 3001);

const app = await buildServer();
try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
  app.log.info(`Données stockées dans : ${dataDir()}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
