import pool from '../db/pgvector';

export async function initializeDatabase() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id SERIAL PRIMARY KEY,
      content TEXT UNIQUE,
      embedding VECTOR(1536)
    );
  `);
    console.log('✅ PostgreSQL table initialized');
}
