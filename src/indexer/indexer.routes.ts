import { FastifyInstance } from 'fastify';
import * as service from './indexer.service.ts';
import { Block } from './indexer.types.ts';

export async function registerIndexerRoutes(fastify: FastifyInstance) {

  // --- Endpoint 1: POST /blocks ---
  fastify.post('/blocks', async (request, reply) => {
    try {
      const block = request.body as Block;
      await service.processNewBlock(block);
      return reply.status(201).send({ message: `Block ${block.height} added successfully` });
    } catch (error: any) {
      fastify.log.error(error, "Error processing block");
      return reply.status(400).send({ error: error.message });
    }
  });

  // --- Endpoint 2: GET /balance/:address ---
  fastify.get('/balance/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const balance = await service.getBalance(address);
      return reply.send({ balance });
    } catch (error: any) {
      fastify.log.error(error, "Error getting balance");
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // --- Endpoint 3: POST /rollback ---
  fastify.post('/rollback', async (request, reply) => {
    try {
      const { height } = request.query as { height: string };
      const targetHeight = parseInt(height, 10);

      if (isNaN(targetHeight) || targetHeight < 0) {
        return reply.status(400).send({ error: "Invalid height parameter." });
      }

      await service.rollbackToHeight(targetHeight);
      return reply.send({ message: `Successfully rolled back to height ${targetHeight}` });
    } catch (error: any) {
      fastify.log.error(error, "Error rolling back");
      // Check if it was our "nothing to roll back" error
      if (error.message.includes("Already at or below height")) {
        return reply.status(400).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
  });
}