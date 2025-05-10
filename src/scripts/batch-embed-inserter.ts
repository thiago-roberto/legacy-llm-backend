import {insertEmbeddingsBulk} from "../db/pgvector";
import { OpenAIEmbeddings } from '@langchain/openai';

export async function batchEmbedInsert(
    texts: string[],
    metas: any[],
    embedder: OpenAIEmbeddings,
    inserter: typeof insertEmbeddingsBulk,
    batchSize: number
) {
    let done = 0;
    for (let i = 0; i < texts.length; i += batchSize) {
        const sliceTexts = texts.slice(i, i + batchSize);
        const sliceMetas = metas.slice(i, i + batchSize);
        const vectors    = await embedder.embedDocuments(sliceTexts);
        await inserter(sliceTexts, sliceMetas, vectors);
        done += sliceTexts.length;
        console.log(`✅ [${new Date().toISOString()}] Inserted ${done}/${texts.length}`);
    }
}
