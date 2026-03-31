import pino from 'pino';
import { createServer } from './api/server';
import { loadConfig } from './config';
import { runIndexer } from './indexer/runner';

const logger = pino({ name: 'main' });

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info(
    { rpcUrl: config.rpcUrl, programId: config.programId },
    'Starting Solana Program Indexer',
  );

  const server = await createServer();
  await server.listen({ port: 3000, host: '0.0.0.0' });
  logger.info('API server listening on port 3000');

  await runIndexer(config);
  logger.info('Indexing finished. API server remains running.');
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
