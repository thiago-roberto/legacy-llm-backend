import pool from '../db/pgvector';

/**
 * Initialize the `documents` table and associated index, ensuring no oversized B-tree index.
 */
export async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Ensure pgvector extension
        await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

        // Create documents table without UNIQUE constraint on content
        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                                                     id SERIAL PRIMARY KEY,
                                                     content TEXT,
                                                     embedding VECTOR
            );
        `);

        // Drop any existing unique constraint or index on content
        await client.query(`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_content_key;`);
        await client.query(`DROP INDEX IF EXISTS documents_content_key;`);
        await client.query(`DROP INDEX IF EXISTS documents_content_md5_idx;`);

        // Enforce uniqueness via MD5 hash index to avoid large B-tree entries
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS documents_content_md5_idx
      ON documents (md5(content));
    `);

        console.log('✅ documents table and hash index are ready');
    } finally {
        client.release();
    }
}