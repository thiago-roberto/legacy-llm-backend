import { Pool } from 'pg';
import { OpenAIEmbeddings } from '@langchain/openai';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const embedder = new OpenAIEmbeddings();

/**
 * Ensure the pgvector extension is available.
 */
export async function initPgvector() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        console.log('✅ pgvector extension is active');
    } finally {
        client.release();
    }
}

/**
 * Bulk-insert text embeddings, using md5(content) for uniqueness.
 */
export async function insertEmbeddingsBulk(
    texts: string[],
    metadatas: object[],
    vectors: number[][]
) {
    const client = await pool.connect();
    try {
        // We'll build a list of parameter placeholders and a flat params array
        const valueClauses: string[] = [];
        const params: any[] = [];

        texts.forEach((_, idx) => {
            const contentIdx = params.length + 1;
            params.push(texts[idx]);

            const vec = vectors[idx];
            const vecLit = `[${vec.join(',')}]`;
            const vectorIdx = params.length + 1;
            params.push(vecLit);

            const metaIdx = params.length + 1;
            params.push(metadatas[idx]);

            valueClauses.push(`($${contentIdx}, $${vectorIdx}::vector, $${metaIdx}::jsonb)`);
        });

        const sql = `
            INSERT INTO documents (content, embedding, metadata)
            VALUES ${valueClauses.join(',')}
                ON CONFLICT DO NOTHING;
        `;
        await client.query(sql, params);
    } finally {
        client.release();
    }
}

export async function searchSimilar(
    input: string,
    topK = 5
): Promise<{ content: string; metadata: any }[]> {
    const embedding = await embedder.embedQuery(input);
    const vecLit = `[${embedding.join(',')}]`;
    const { rows } = await pool.query(
        `SELECT content, metadata
     FROM documents
     ORDER BY embedding <-> $1::vector
     LIMIT $2`,
        [vecLit, topK]
    );
    return rows;
}

export default pool;
