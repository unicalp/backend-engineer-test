import Fastify from 'fastify';
import { setupDatabase, sql, pool } from './db/index.ts'; 
import crypto from 'crypto'; 

const fastify = Fastify({
 logger: true 
});

// --- Define the Types (from the README) ---
type Output = { address: string; value: number; };
type Input = { txId: string; index: number; };
type Transaction = { id: string; inputs: Array<Input>; outputs: Array<Output>; };
type Block = { id: string; height: number; transactions: Array<Transaction>; };


// --- Endpoint 1: POST /blocks ---
fastify.post('/blocks', async (request, reply) => {
 const block = request.body as Block;
 const client = await pool.connect(); // Get a connection from the DB pool

 try {
  // --- 1. Start DB Transaction ---
  await client.query('BEGIN');

  // --- 2. Get Current Height ---
  const heightResult = await client.query('SELECT current_height FROM blockchain_state WHERE id = 1');
  const currentHeight = heightResult.rows[0].current_height;

  // --- 3. Validation 1 (Height) ---
  if (block.height !== currentHeight + 1) {
   throw new Error(`Invalid height. Expected ${currentHeight + 1} but got ${block.height}`);
  }

  // --- 4. Validation 2 (Block ID) ---
  const txIds = block.transactions.map(tx => tx.id).join('');
    const dataToHash = String(block.height) + txIds;
    
  const calculatedHash = crypto
   .createHash('sha256')
   .update(dataToHash)
   .digest('hex');

  if (calculatedHash !== block.id) {
   throw new Error('Invalid block hash');
  }

  // --- 5. Process Transactions ---
  for (const tx of block.transactions) {
   let totalInputValue = 0n; // Use BigInt for currency
   let totalOutputValue = 0n;

   // 5a. Process Inputs (Spending)
   if (tx.inputs.length > 0) {
    for (const input of tx.inputs) {
     // Find the UTXO this input is trying to spend
     const utxoResult = await client.query(
      'SELECT address, value FROM utxos WHERE tx_id = $1 AND output_index = $2 AND is_spent = false',
      [input.txId, input.index]
     );
     if (utxoResult.rows.length === 0) {
      // If the UTXO isn't found or is already spent, this is an invalid transaction (double-spend)
      throw new Error(`Invalid input: UTXO ${input.txId}:${input.index} not found or already spent.`);
     }
     const utxo = utxoResult.rows[0];
     const utxoValue = BigInt(utxo.value);
     totalInputValue += utxoValue;

     // Mark the UTXO as "spent"
     await client.query(
      'UPDATE utxos SET is_spent = true, spent_in_block = $1 WHERE tx_id = $2 AND output_index = $3',
      [block.height, input.txId, input.index]
     );
     // Subtract the balance from the sender's address
     await client.query(
      'UPDATE address_balances SET balance = balance - $1 WHERE address = $2',
      [utxoValue, utxo.address]
     );
    }
   }

   // 5b. Process Outputs (Receiving)
   for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i];
    const outputValue = BigInt(output.value);
    totalOutputValue += outputValue;

    // Create the new UTXO
    await client.query(
     'INSERT INTO utxos (tx_id, output_index, address, value, created_in_block) VALUES ($1, $2, $3, $4, $5)',
     [tx.id, i, output.address, outputValue, block.height]
    );
    // Add balance to the receiver's address (or create the address)
    await client.query(
     `INSERT INTO address_balances (address, balance) 
     VALUES ($1, $2) 
     ON CONFLICT (address) 
     DO UPDATE SET balance = address_balances.balance + $2`,
     [output.address, outputValue]
    );
   }

   // --- 6. Validation 3 (Sum) ---
   if (tx.inputs.length > 0 && totalInputValue !== totalOutputValue) {
    throw new Error(`Transaction ${tx.id} sum mismatch: Inputs ${totalInputValue} != Outputs ${totalOutputValue}`);
	  }
  }

  // --- 7. Finalize Block ---
  // Save the raw block for rollbacks
  await client.query(
   'INSERT INTO blocks (height, id, raw_block) VALUES ($1, $2, $3)',
   [block.height, block.id, JSON.stringify(block)]
  );
  // Update the chain's current height
  await client.query(
   'UPDATE blockchain_state SET current_height = $1 WHERE id = 1',
   [block.height]
  );

  // --- 8. Commit DB Transaction ---
  await client.query('COMMIT');
  return reply.status(201).send({ message: `Block ${block.height} added successfully` });

 } catch (error: any) {
  // --- Error Case: Roll Back All Changes ---
  await client.query('ROLLBACK');
  fastify.log.error(error, "Error processing block");
  return reply.status(400).send({ error: error.message });

 } finally {
  // --- Release the Client Back to the Pool ---
  client.release();
 }
});

// --- Endpoint 2: GET /balance/:address ---
fastify.get('/balance/:address', async (request, reply) => {
 // Get the address from the URL parameters
 const { address } = request.params as { address: string };

 try {
  // Query our fast balance table
  const result = await sql.query(
   'SELECT balance FROM address_balances WHERE address = $1',
   [address]
  );

  // If the address isn't in the table, it has no transactions, balance is 0
  if (result.rows.length === 0) {
   return reply.send({ balance: 0 }); 
  }

  // Send the balance, converting BigInt to a regular number
  return reply.send({ balance: Number(result.rows[0].balance) });

 } catch (error: any) {
  fastify.log.error(error, "Error getting balance");
  return reply.status(500).send({ error: "Internal server error" });
 }
});

// --- Endpoint 3: POST /rollback ---
fastify.post('/rollback', async (request, reply) => {
  // ?height=... query parametresini al
  const { height } = request.query as { height: string };
  const targetHeight = parseInt(height, 10);

  if (isNaN(targetHeight) || targetHeight < 0) {
    return reply.status(400).send({ error: "Invalid height parameter." });
  }

  const client = await pool.connect();

  try {
    // --- 1. DB Transaction Başlat ---
    await client.query('BEGIN');

    // Geri alınacak blokları bul (en yeniden en eskiye doğru)
    const blocksToRollbackResult = await client.query(
      'SELECT height, raw_block FROM blocks WHERE height > $1 ORDER BY height DESC',
      [targetHeight]
    );

    if (blocksToRollbackResult.rows.length === 0) {
      throw new Error(`Already at or below height ${targetHeight}. No blocks to rollback.`);
    }

    // --- 2. Her Bloğu Tersine Çevir ---
    for (const row of blocksToRollbackResult.rows) {
      const block = row.raw_block as Block;

      for (const tx of block.transactions) {

        // 2a. Çıktıları (Outputs) Geri Al
        // Bu işlem tarafından oluşturulan tüm UTXO'ları sil
        await client.query(
          'DELETE FROM utxos WHERE tx_id = $1',
          [tx.id]
        );

        // Bakiyeleri alan adreslerden geri düş
        for (const output of tx.outputs) {
          await client.query(
            'UPDATE address_balances SET balance = balance - $1 WHERE address = $2',
            [BigInt(output.value), output.address]
          );
        }

        // 2b. Girdileri (Inputs) Geri Al
        // Bu işlem tarafından harcanan tüm UTXO'ları "harcanmamış" olarak geri ayarla
        for (const input of tx.inputs) {
          // Harcanan UTXO'nun orijinal adresini ve değerini bulmamız gerekiyor
          const utxoResult = await client.query(
            'SELECT address, value FROM utxos WHERE tx_id = $1 AND output_index = $2',
            [input.txId, input.index]
          );

          if (utxoResult.rows.length > 0) {
            const utxo = utxoResult.rows[0];
            const utxoValue = BigInt(utxo.value);

            // UTXO'yu "harcanmamış" olarak işaretle
            await client.query(
              'UPDATE utxos SET is_spent = false, spent_in_block = NULL WHERE tx_id = $1 AND output_index = $2',
              [input.txId, input.index]
            );

            // Bakiyeyi orijinal sahibine geri yükle
            await client.query(
              'UPDATE address_balances SET balance = balance + $1 WHERE address = $2',
              [utxoValue, utxo.address]
            );
          }
        }
      }

      // 2c. Bloğun kendisini sil
      await client.query('DELETE FROM blocks WHERE height = $1', [block.height]);
    }

    // --- 3. Zincir Durumunu Güncelle ---
    // Mevcut yüksekliği, geri aldığımız yüksekliğe ayarla
    await client.query(
      'UPDATE blockchain_state SET current_height = $1 WHERE id = 1',
      [targetHeight]
    );

    // --- 4. DB Transaction'ı Onayla ---
    await client.query('COMMIT');

    return reply.send({ message: `Successfully rolled back to height ${targetHeight}` });

  } catch (error: any) {
    await client.query('ROLLBACK');
    fastify.log.error(error, "Error rolling back");
    return reply.status(500).send({ error: error.message });
  } finally {
    client.release();
  }
});

// --- Start Server Function ---
const start = async () => {
 console.log("--- API STARTING ---");

 try {
  await setupDatabase(); // Set up the DB tables
  await fastify.listen({ port: 3000, host: '0.0.0.0' }); 
 } catch (err) {
  fastify.log.error(err);
  process.exit(1);
 }
};

start();