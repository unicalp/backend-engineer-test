import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const sql = {
  query: (text: string, params: any[] = []) => pool.query(text, params),
};


export async function setupDatabase() {
  try {
    await sql.query(`
    
      CREATE TABLE IF NOT EXISTS blockchain_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        current_height INTEGER NOT NULL DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        raw_block JSONB NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS utxos (
        tx_id TEXT NOT NULL,
        output_index INTEGER NOT NULL,
        address TEXT NOT NULL,
        value BIGINT NOT NULL,
        is_spent BOOLEAN NOT NULL DEFAULT false,
        spent_in_block INTEGER,
        created_in_block INTEGER NOT NULL,
        PRIMARY KEY (tx_id, output_index)
      );
      
      CREATE TABLE IF NOT EXISTS address_balances (
        address TEXT PRIMARY KEY,
        balance BIGINT NOT NULL DEFAULT 0
      );
      
      -- This makes sure our blockchain_state table always has its first row.
      INSERT INTO blockchain_state (id, current_height)
      VALUES (1, 0)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log("✅ Database tables created/verified successfully.");
  } catch (error) {
    console.error("❌ Error setting up database:", error);
    process.exit(1); // Stop the app if the DB setup fails
  }
}