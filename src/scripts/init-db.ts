import pool from '../db/pgvector';

export async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS rag_vectors (
                id SERIAL PRIMARY KEY, 
                content TEXT NOT NULL UNIQUE,
                embedding VECTOR(1536)
            );
        `);

        console.log('✅ pgvector database and table ready');
    } finally {
        client.release();
    }
}
