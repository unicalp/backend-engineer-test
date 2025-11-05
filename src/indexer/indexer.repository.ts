import { Pool, PoolClient } from 'pg';
import { Block, Transaction, Input, Output } from './indexer.types.ts';

// Helper function to get the current height
export async function getCurrentHeight(client: PoolClient): Promise<number> {
  const result = await client.query('SELECT current_height FROM blockchain_state WHERE id = 1');
  return result.rows[0].current_height;
}

// Helper to get a balance
export async function getBalanceByAddress(pool: Pool, address: string): Promise<number> {
  const result = await pool.query('SELECT balance FROM address_balances WHERE address = $1', [address]);
  if (result.rows.length === 0) {
    return 0;
  }
  return Number(result.rows[0].balance);
}

// Spends UTXOs and updates balances in one function
export async function spendUtxos(client: PoolClient, inputs: Input[], blockHeight: number) {
  let totalInputValue = 0n;
  for (const input of inputs) {
    const utxoResult = await client.query(
      'SELECT address, value FROM utxos WHERE tx_id = $1 AND output_index = $2 AND is_spent = false',
      [input.txId, input.index]
    );
    if (utxoResult.rows.length === 0) {
      throw new Error(`Invalid input: UTXO ${input.txId}:${input.index} not found or already spent.`);
    }
    const utxo = utxoResult.rows[0];
    const utxoValue = BigInt(utxo.value);
    totalInputValue += utxoValue;

    await client.query(
      'UPDATE utxos SET is_spent = true, spent_in_block = $1 WHERE tx_id = $2 AND output_index = $3',
      [blockHeight, input.txId, input.index]
    );
    await client.query(
      'UPDATE address_balances SET balance = balance - $1 WHERE address = $2',
      [utxoValue, utxo.address]
    );
  }
  return totalInputValue;
}

// Creates new UTXOs and updates balances
export async function createUtxos(client: PoolClient, tx: Transaction, blockHeight: number) {
  let totalOutputValue = 0n;
  for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i];
    const outputValue = BigInt(output.value);
    totalOutputValue += outputValue;

    await client.query(
      'INSERT INTO utxos (tx_id, output_index, address, value, created_in_block) VALUES ($1, $2, $3, $4, $5)',
      [tx.id, i, output.address, outputValue, blockHeight]
    );
    await client.query(
      `INSERT INTO address_balances (address, balance) 
       VALUES ($1, $2) 
       ON CONFLICT (address) 
       DO UPDATE SET balance = address_balances.balance + $2`,
      [output.address, outputValue]
    );
  }
  return totalOutputValue;
}

// Saves the block and updates the chain height
export async function finalizeBlock(client: PoolClient, block: Block) {
  await client.query(
    'INSERT INTO blocks (height, id, raw_block) VALUES ($1, $2, $3)',
    [block.height, block.id, JSON.stringify(block)]
  );
  await client.query(
    'UPDATE blockchain_state SET current_height = $1 WHERE id = 1',
    [block.height]
  );
}

// --- Rollback Functions ---

export async function getBlocksToRollback(client: PoolClient, targetHeight: number) {
  const result = await client.query(
    'SELECT height, raw_block FROM blocks WHERE height > $1 ORDER BY height DESC',
    [targetHeight]
  );
  return result.rows;
}

export async function undoTransactionOutputs(client: PoolClient, tx: Transaction) {
  await client.query('DELETE FROM utxos WHERE tx_id = $1', [tx.id]);
  for (const output of tx.outputs) {
    await client.query(
      'UPDATE address_balances SET balance = balance - $1 WHERE address = $2',
      [BigInt(output.value), output.address]
    );
  }
}

export async function undoTransactionInputs(client: PoolClient, inputs: Input[]) {
  for (const input of inputs) {
    const utxoResult = await client.query(
      'SELECT address, value FROM utxos WHERE tx_id = $1 AND output_index = $2',
      [input.txId, input.index]
    );
    if (utxoResult.rows.length > 0) {
      const utxo = utxoResult.rows[0];
      await client.query(
        'UPDATE utxos SET is_spent = false, spent_in_block = NULL WHERE tx_id = $1 AND output_index = $2',
        [input.txId, input.index]
      );
      await client.query(
        'UPDATE address_balances SET balance = balance + $1 WHERE address = $2',
        [BigInt(utxo.value), utxo.address]
      );
    }
  }
}

export async function deleteBlock(client: PoolClient, blockHeight: number) {
    await client.query('DELETE FROM blocks WHERE height = $1', [blockHeight]);
}

export async function setChainHeight(client: PoolClient, height: number) {
    await client.query('UPDATE blockchain_state SET current_height = $1 WHERE id = 1', [height]);
}