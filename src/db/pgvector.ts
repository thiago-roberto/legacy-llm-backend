import { Pool } from 'pg';
import { OpenAIEmbeddings } from '@langchain/openai';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // e.g., postgres://user:pass@localhost:5432/ragdb
});
console.log('🧪 DATABASE_URL:', process.env.DATABASE_URL);
const embedder = new OpenAIEmbeddings();

export async function initPgvector() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log('✅ pgvector extension is active');
}

export async function insertEmbeddings(texts: string[]) {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(`SELECT COUNT(*) FROM rag_vectors`);
        const currentCount = parseInt(rows[0].count, 10);
        const remaining = Math.max(0, 400 - currentCount);
        console.log('remaining', remaining);
        if (remaining <= 0) {
            console.log('⚠️  Skipping insertion: 400 embeddings already exist.');
            return;
        }

        const textsToInsert = texts.slice(0, remaining);
        for (const text of textsToInsert) {
            const embeddingArr = await embedder.embedQuery(text);
            const formattedEmbedding = `[${embeddingArr.join(',')}]`;

            try {
                await client.query(
                    'INSERT INTO rag_vectors (content, embedding) VALUES ($1, $2) ON CONFLICT (content) DO NOTHING',
                    [text, formattedEmbedding]
                );
            } catch (err) {
                console.warn(`⚠️  Failed to insert: ${text.substring(0, 40)}...`, err.message);
            }
        }

        console.log(`✅ Inserted ${textsToInsert.length} new embeddings`);
    } finally {
        client.release();
    }
}





export async function searchSimilar(input: string, topK = 5): Promise<string[]> {
    const embeddingArr = await embedder.embedQuery(input);
    const formatted = `[${embeddingArr.join(',')}]`;
    const result = await pool.query(
        `SELECT content FROM rag_vectors
         ORDER BY embedding <#> $1
         LIMIT $2`,
        [formatted, topK]
    );
    return result.rows.map((row) => row.content);
}



export default pool;