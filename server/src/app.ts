import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { playerFromToken } from './auth';
import { GameError } from './errors';
import { env } from './env';
import { register } from './notify';
import authRoutes from './routes/auth';
import mapRoutes from './routes/map';
import socialRoutes from './routes/social';
import villageRoutes from './routes/village';

export async function buildApp(opts: { logger?: boolean; corsOrigins?: string[] } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  // CORS : l'application mobile embarque le client et appelle l'API depuis son origine locale.
  // L'authentification passe par un jeton dans l'en-tête (pas de cookie), d'où une liste blanche simple.
  const origins = new Set(opts.corsOrigins ?? env.corsOrigins);
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !origins.has(origin)) return;
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      reply.header('access-control-allow-headers', 'authorization,content-type');
      reply.header('access-control-max-age', '86400');
      return reply.status(204).send();
    }
  });

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: err.issues[0]?.message ?? 'Requête invalide' });
    if ((err as any).statusCode === 429) return reply.status(429).send({ error: 'Trop de requêtes, ralentissez un peu' });
    app.log.error(err);
    return reply.status(500).send({ error: 'Erreur interne du serveur' });
  });

  // Canal temps réel : le serveur prévient le client quand il doit rafraîchir quelque chose.
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as Record<string, string>).token;
    const playerId = await playerFromToken(token);
    if (!playerId) {
      socket.close(4001, 'unauthorized');
      return;
    }
    register(playerId, socket);
    socket.send(JSON.stringify({ type: 'hello' }));
  });

  await app.register(authRoutes);
  await app.register(villageRoutes);
  await app.register(mapRoutes);
  await app.register(socialRoutes);
  return app;
}
