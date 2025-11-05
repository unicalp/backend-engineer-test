import Fastify from 'fastify';
import { setupDatabase } from './db/index.ts';
import { registerIndexerRoutes } from './indexer/indexer.routes.ts';

const fastify = Fastify({
  logger: true
});

// --- Start Server Function ---
const start = async () => {
  console.log("--- API STARTING ---");
  try {
    // Set up the DB tables
    await setupDatabase(); 

    // Register all our routes
    registerIndexerRoutes(fastify);

    // Start the server
    await fastify.listen({ port: 3000, host: '0.0.0.0' });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();