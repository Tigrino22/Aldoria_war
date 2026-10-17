import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import zlib from 'node:zlib';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { ZodError } from 'zod';
import { requestSession, sessionFromToken } from './auth';
import { GameError } from './errors';
import { env } from './env';
import { register } from './notify';
import { defaultWorld, inWorld, worldById } from './world-store';
import allianceRoutes from './routes/alliances';
import authRoutes from './routes/auth';
import crusadeRoutes from './routes/crusade';
import mapRoutes from './routes/map';
import adminRoutes from './routes/admin';
import managerRoutes from './routes/manager';
import marketRoutes from './routes/market';
import questRoutes from './routes/quests';
import socialRoutes from './routes/social';
import statsRoutes from './routes/stats';
import villageRoutes from './routes/village';
import itemRoutes from './routes/items';
import worldRoutes from './routes/worlds';

export async function buildApp(opts: { logger?: boolean; corsOrigins?: string[] } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: env.trustProxy });

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
      reply.header('access-control-allow-headers', 'authorization,content-type,x-world');
      reply.header('access-control-max-age', '86400');
      return reply.status(204).send();
    }
  });

  // Réponses compressées (gzip/brotli) : les listes JSON et le code du site pèsent 4 à 5 fois moins sur mobile.
  // Brotli au niveau 4 : presque aussi compact que le maximum, pour une fraction du calcul (le serveur gratuit a peu de processeur).
  await app.register(compress, { threshold: 1024, brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } } });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: err.issues[0]?.message ?? 'Requête invalide' });
    if ((err as any).statusCode === 429) return reply.status(429).send({ error: 'Trop de requêtes, ralentissez un peu' });
    app.log.error(err);
    return reply.status(500).send({ error: 'Erreur interne du serveur' });
  });

  // Chaque requête de l'API s'exécute dans un monde : celui choisi par le joueur à la connexion, ou, pour l'administrateur
  // sur les routes d'administration, celui indiqué par l'en-tête x-world. Sans session, le monde par défaut.
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api')) return;
    const handler = route.handler as (this: unknown, req: FastifyRequest, reply: FastifyReply) => unknown;
    route.handler = async function (req, reply) {
      const s = await requestSession(req);
      const asked = Number(req.headers['x-world']);
      let w = s?.worldId ? worldById(s.worldId) : null;
      if (asked && s?.isAdmin && req.url.startsWith('/api/admin')) {
        w = worldById(asked);
        if (!w) throw new GameError('Monde introuvable', 404);
      }
      return inWorld(w ?? defaultWorld(), () => handler.call(this, req, reply));
    };
  });

  // Canal temps réel : le serveur prévient le client quand il doit rafraîchir quelque chose.
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as Record<string, string>).token;
    const s = await sessionFromToken(token);
    if (!s?.worldId || !s.playerId) {
      socket.close(4001, 'unauthorized');
      return;
    }
    register(s.worldId, s.playerId, socket);
    socket.send(JSON.stringify({ type: 'hello' }));
  });

  await app.register(authRoutes);
  await app.register(villageRoutes);
  await app.register(managerRoutes);
  await app.register(mapRoutes);
  await app.register(allianceRoutes);
  await app.register(marketRoutes);
  await app.register(adminRoutes);
  await app.register(questRoutes);
  await app.register(socialRoutes);
  await app.register(statsRoutes);
  await app.register(crusadeRoutes);
  await app.register(itemRoutes);
  await app.register(worldRoutes);

  // En production, le même serveur distribue aussi le site (le client utilise des routes en #, donc
  // tout chemin inconnu hors /api renvoie la page d'accueil).
  if (env.staticDir) {
    const root = path.resolve(env.staticDir);
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
      cacheControl: false,
      // Les fichiers de assets/ portent une empreinte dans leur nom : le navigateur les garde un an sans redemander.
      // La page d'accueil, elle, est toujours revérifiée pour récupérer la dernière version du jeu.
      setHeaders(res, filePath) {
        res.setHeader('cache-control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      return reply.status(404).send({ error: 'Introuvable' });
    });
  }
  return app;
}
