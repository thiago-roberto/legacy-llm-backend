import pool, {insertEmbeddingsBulk} from "../db/pgvector";
import {isValidContent} from "../helpers/valid-content-check";
import fs from 'fs';
import path from 'path';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { parse } from 'csv-parse/sync';

const embedder = new OpenAIEmbeddings();
const MAX_DOCS = 11163;

export async function prepareRAGStore() {
    console.log(`📚 [${new Date().toISOString()}] Starting RAG store preparation…`);
    const { rows } = await pool.query('SELECT COUNT(*) AS c FROM documents');
    const existingCount = parseInt(rows[0].c, 10);
    console.log(`🗄️  [${new Date().toISOString()}] ${existingCount} docs already in database.`);

    if (existingCount >= MAX_DOCS) {
        console.log(`✅ [${new Date().toISOString()}] Reached cap of ${MAX_DOCS} docs—skipping ingest.`);
        return;
    }

    const remaining = MAX_DOCS - existingCount;
    console.log(`⚙️  [${new Date().toISOString()}] Will ingest up to ${remaining} new docs.`);

    const docs: Document[] = [];
    const filePaths = [
        'src/datasets/20200325_counsel_chat.csv',
        'src/datasets/counselchat-data.csv',
        'src/datasets/psychology_dataset.csv',
    ];

    for (const file of filePaths) {
        const fullPath = path.resolve(file);
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const ext = path.extname(fullPath);
        const sourceName = path.basename(file);
        console.log(`🔍 [${new Date().toISOString()}] Parsing ${sourceName}…`);

        if (ext === '.csv' && sourceName === '20200325_counsel_chat.csv') {
            const records: any[] = parse(raw, {
                columns: true,
                skip_empty_lines: true,
                relax_quotes: true,
                trim: true,
            });
            records.forEach((rec, idx) => {
                const title = (rec.questionTitle as string).trim();
                const text  = (rec.questionText  as string).trim();
                const combined = [title, text]
                    .filter(Boolean)
                    .join('\n\n');
                if (combined && isValidContent(combined)) {
                    docs.push(new Document({
                        pageContent: combined,
                        metadata: {name: sourceName}
                    }));
                }
            });

        } else if (ext === '.csv' && sourceName === 'counselchat-data.csv') {
            const records: any[] = parse(raw, {
                columns: true,
                skip_empty_lines: true,
                relax_quotes: true,
                trim: true
            });
            records.forEach((rec, idx) => {
                const q = (rec.questionText as string).trim();
                const rawAnswer = (rec.answerText as string) || '';
                const cleanAnswer = rawAnswer.replace(/<[^>]*>?/gm, '').trim();
                const combined = [q, cleanAnswer].filter(Boolean).join('\n\n');
                if (combined && isValidContent(combined)) {
                    docs.push(new Document({
                        pageContent: combined,
                        metadata: {name: sourceName}
                    }));
                }
            });

        } else if (ext === '.csv' && sourceName === 'psychology_dataset.csv') {
            const records: any[] = parse(raw, {
                columns: true,
                skip_empty_lines: true,
                relax_quotes: true,
                trim: true,
            });

            records.forEach((rec, idx) => {
                const q  = (rec.question   as string).trim();
                const rj = (rec.response_j as string).trim();

                const combo = [q, rj].filter(Boolean).join('\n\n');
                if (combo && isValidContent(combo)) {
                    docs.push(new Document({
                        pageContent: combo,
                        metadata: {name: sourceName}
                    }));
                }

                // we can use the bad answers from column response_k to train the model about what NOT to answer
            });
        }

        console.log(`🔍 [${new Date().toISOString()}] Loaded ${docs.length} docs so far.`);
    }

    const counts = filePaths.map(f => {
        const name = path.basename(f);
        return {
            source: name,
            validCount: docs.filter(d => d.metadata.name === name && isValidContent(d.pageContent)).length
        };
    });
    console.table(counts);

    const filteredAll = docs.filter(d => isValidContent(d.pageContent));
    const filtered = filteredAll.slice(0, remaining);
    const texts = filtered.map(d => d.pageContent);
    const metadatas = filtered.map(d => d.metadata);

    const BATCH_SIZE = 1000;
    let insertedCount = 0;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const textBatch     = texts.slice(i, i + BATCH_SIZE);
        const metaBatch     = metadatas.slice(i, i + BATCH_SIZE);
        const vectors       = await embedder.embedDocuments(textBatch);

        await insertEmbeddingsBulk(textBatch, metaBatch, vectors);
        insertedCount += textBatch.length;
        console.log(`✅ Inserted ${textBatch.length} docs in this batch; total so far: ${insertedCount}`);
    }
}