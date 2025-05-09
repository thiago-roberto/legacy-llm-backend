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
    vectors: number[][]
) {
    const client = await pool.connect();
    try {
        // Build parameterized VALUES clauses
        const params: string[] = [];
        const valueClauses = texts.map((_, idx) => {
            const textParamIndex = params.length + 1;
            params.push(texts[idx]);
            const vecLit = `[${vectors[idx].join(',')}]`;
            const vecParamIndex = params.length + 1;
            params.push(vecLit);
            return `($${textParamIndex}, $${vecParamIndex}::vector)`;
        }).join(',');

        const sql = `
      INSERT INTO documents (content, embedding)
      VALUES ${valueClauses}
      ON CONFLICT DO NOTHING;
    `;
        await client.query(sql, params);
    } finally {
        client.release();
    }
}

/**
 * Perform similarity search over stored embeddings.
 */
export async function searchSimilar(
    input: string,
    topK = 5
): Promise<string[]> {
    const embeddingArr = await embedder.embedQuery(input);
    const result = await pool.query(
        `
      SELECT content
      FROM documents
      ORDER BY embedding <-> $1
      LIMIT $2
    `,
        [embeddingArr, topK]
    );
    return result.rows.map(row => row.content);
}

export default pool;
