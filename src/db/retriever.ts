import { Pool } from "pg";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import type { Document } from "@langchain/core/documents";

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const embedder = new OpenAIEmbeddings();

const SOURCE_COUNTS: Record<string, number> = {
    "20200325_counsel_chat.csv":  813,
    "counselchat-data.csv":       1004,
    "psychology_dataset.csv":     9846,
};

let store: PGVectorStore | null = null;
async function getStore() {
    if (store) return store;
    store = new PGVectorStore(embedder, {
        pool,
        tableName: "documents",
        columns: {
            vectorColumnName:   "embedding",
            contentColumnName:  "content",
            metadataColumnName: "metadata",
        },
    });
    return store;
}

export async function mmrSearch(query: string, totalK = 5) {
    const vs = await getStore();

    const entries = Object.entries(SOURCE_COUNTS);
    const invWeights = entries.map(([src, cnt]) => 1 / cnt);
    const weightSum  = invWeights.reduce((a, b) => a + b, 0);
    const quotas: Record<string, number> = {};
    entries.forEach(([src], i) => {
        quotas[src] = Math.max(1,
            Math.round(invWeights[i] / weightSum * totalK)
        );
    });

    let allocated = Object.values(quotas).reduce((a, b) => a + b, 0);
    while (allocated < totalK) {
        const [minSrc] = entries.reduce((best, e) => {
            return quotas[e[0]] < quotas[best[0]] ? e : best;
        }, entries[0]);
        quotas[minSrc]++;
        allocated++;
    }
    while (allocated > totalK) {
        const [maxSrc] = entries.reduce((best, e) => {
            return quotas[e[0]] > quotas[best[0]] ? e : best;
        }, entries[0]);
        if (quotas[maxSrc] > 1) {
            quotas[maxSrc]--;
            allocated--;
        } else break;
    }

    const allDocs: { src: string; doc: Document; score: number }[] = [];
    await Promise.all(
        entries.map(async ([src]) => {
            const q = quotas[src];
            if (q <= 0) return;

            const candidates = await vs.maxMarginalRelevanceSearch(query, {
                k:      q,
                fetchK: 50,        // bigger pool
                lambda: 0.0,       // max embedding‐space diversity
                filter: { name: src },
            });

            const scored = await vs.similaritySearchWithScore(query, 50, {
                filter: { name: src },
            });

            const scoreMap = new Map(scored.map(([d, s]) => [d.pageContent, s]));

            for (const d of candidates) {
                allDocs.push({ src, doc: d, score: scoreMap.get(d.pageContent) ?? 0 });
            }
        })
    );

    const boostFactors = Object.fromEntries(
        entries.map(([src, cnt]) => [src, 1 + (invWeights[entries.findIndex(e=>e[0]===src)]/weightSum)])
    );

    const final = allDocs
        .reduce((uniq, cur) => {
            if (!uniq.some(u=>u.doc.pageContent===cur.doc.pageContent)) {
                uniq.push(cur);
            }
            return uniq;
        }, [] as typeof allDocs)
        .map(({ src, doc, score }) => ({
            doc,
            boosted: score * (boostFactors[src] || 1),
        }))
        .sort((a, b) => b.boosted - a.boosted)
        .slice(0, totalK)
        .map(x => x.doc);

    return final;
}
