import Fastify from 'fastify';
import { registerRoutes } from './routes';

export async function createServer() {
  const server = Fastify({
    logger: true,
  });

  registerRoutes(server);

  return server;
}
