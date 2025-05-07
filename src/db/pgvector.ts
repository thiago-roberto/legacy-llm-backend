import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Ensure this is set in your .env
});

export async function initPgvector() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    console.log('🧩 pgvector extension ensured.');
}

export async function insertEmbedding(content: string, embedding: number[]) {
    await pool.query(
        `INSERT INTO rag_documents (content, embedding) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [content, embedding]
    );
}

export async function searchSimilarEmbeddings(queryEmbedding: number[], topK: number) {
    const result = await pool.query(
        `SELECT content FROM rag_documents ORDER BY embedding <-> $1 LIMIT $2`,
        [queryEmbedding, topK]
    );
    return result.rows.map(r => r.content);
}

export default pool;
