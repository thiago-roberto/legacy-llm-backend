import pool from '../db/pgvector';

export async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                                                     id SERIAL PRIMARY KEY,
                                                     content TEXT,
                                                     metadata JSONB, 
                                                     embedding VECTOR
            );
        `);

        await client.query(`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_content_key;`);
        await client.query(`DROP INDEX IF EXISTS documents_content_key;`);
        await client.query(`DROP INDEX IF EXISTS documents_content_md5_idx;`);

        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS documents_content_md5_idx
      ON documents (md5(content));
    `);

        console.log('✅ documents table and hash index are ready');
    } finally {
        client.release();
    }
}