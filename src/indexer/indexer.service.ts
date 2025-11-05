import { pool } from '../db/index.ts';
import * as repository from './indexer.repository.ts';
import type { Block } from './indexer.types.ts';
import crypto from 'crypto';

export async function processNewBlock(block: Block) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validation 1 (Height)
    const currentHeight = await repository.getCurrentHeight(client);
    if (block.height !== currentHeight + 1) {
      throw new Error(`Invalid height. Expected ${currentHeight + 1} but got ${block.height}`);
    }

    // Validation 2 (Block ID)
    const txIds = block.transactions.map(tx => tx.id).join('');
    const dataToHash = String(block.height) + txIds;
    const calculatedHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
    if (calculatedHash !== block.id) {
      throw new Error('Invalid block hash');
    }

    // Process Transactions
    for (const tx of block.transactions) {
      let totalInputValue = 0n;
      if (tx.inputs.length > 0) {
        totalInputValue = await repository.spendUtxos(client, tx.inputs, block.height);
      }
      const totalOutputValue = await repository.createUtxos(client, tx, block.height);

      // Validation 3 (Sum)
      if (tx.inputs.length > 0 && totalInputValue !== totalOutputValue) {
        throw new Error(`Transaction ${tx.id} sum mismatch: Inputs ${totalInputValue} != Outputs ${totalOutputValue}`);
      }
    }

    // Finalize
    await repository.finalizeBlock(client, block);
    await client.query('COMMIT');

  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error; // Re-throw the error for the controller to catch
  } finally {
    client.release();
  }
}

export async function getBalance(address: string) {
  // This is a simple read, no service logic needed, just call repository
  return repository.getBalanceByAddress(pool, address);
}

export async function rollbackToHeight(targetHeight: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const blocksToRollback = await repository.getBlocksToRollback(client, targetHeight);
    if (blocksToRollback.length === 0) {
      throw new Error(`Already at or below height ${targetHeight}. No blocks to rollback.`);
    }

    for (const row of blocksToRollback) {
      const block = row.raw_block as Block;
      for (const tx of block.transactions) {
        await repository.undoTransactionOutputs(client, tx);
        await repository.undoTransactionInputs(client, tx.inputs);
      }
      await repository.deleteBlock(client, block.height);
    }

    await repository.setChainHeight(client, targetHeight);
    await client.query('COMMIT');

  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error; // Re-throw
  } finally {
    client.release();
  }
}