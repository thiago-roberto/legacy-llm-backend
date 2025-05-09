import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import pool, { insertEmbeddingsBulk, initPgvector, searchSimilar } from './db/pgvector';
import { initializeDatabase } from './scripts/init-db';
import { isValidContent } from './helpers/valid-content-check';
import { sanitizeInput } from './helpers/sanitize-input';
import { withTimeout } from './helpers/timeout';
import { docAssistantPrompt } from './prompts/doc-assistant-prompt';
import { buildHumanPrompt } from './prompts/build-human-prompt';
import { parse } from 'csv-parse/sync';

dotenv.config();

const app = express();
const port = 4000;

app.use(cors({
    origin: [
        'https://aquamarine-cajeta-dc7dc7.netlify.app/',
        'http://localhost:3000'
    ]
}));
app.use(express.json());

let vectorStore: MemoryVectorStore;
const embedder = new OpenAIEmbeddings();
const MAX_DOCS = 12000;

async function prepareRAGStore() {
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
                        metadata: { source: sourceName, row: idx }
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
                        metadata: { source: sourceName, row: idx }
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
                        metadata: {
                            source: sourceName,
                            row: idx
                        }
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
            validCount: docs.filter(d => d.metadata.source === name && isValidContent(d.pageContent)).length
        };
    });
    console.table(counts);

    const filteredAll = docs.filter(d => isValidContent(d.pageContent));
    const filtered = filteredAll.slice(0, remaining);
    const texts = filtered.map(d => d.pageContent);
    const BATCH_SIZE = 1000;
    let insertedCount = 0;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const vectors = await embedder.embedDocuments(batch);
        await insertEmbeddingsBulk(batch, vectors);
        insertedCount += batch.length;
        console.log(`✅ Inserted ${batch.length} docs in this batch; total so far: ${insertedCount}`);
    }

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
    const splitDocs = await splitter.splitDocuments(filtered);
    vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embedder);

    console.log(`✅ [${new Date().toISOString()}] RAG store ready with ${splitDocs.length} vectors.`);
}

app.post('/ask', async (req, res) => {
    const rawInput = req.body.input as string;
    const input = sanitizeInput(rawInput).trim();
    if (!input || input.length > 500) {
        res.status(400).json({ error: 'Invalid input' });
    }
    const model = new ChatOpenAI({ temperature: 0.7, openAIApiKey: process.env.OPENAI_API_KEY });
    try {
        const relevantDocs = await vectorStore.similaritySearch(input, 3);
        const sources = relevantDocs.map(d => d.metadata.source as string);
        const context = relevantDocs.map(d => `[${d.metadata.source}] ${d.pageContent}`).join('\n');
        const response = await withTimeout(
            model.call([
                new SystemMessage(docAssistantPrompt),
                new HumanMessage(buildHumanPrompt(context, input)),
            ]),
            10000
        );
        res.json({ result: response.text, sources });
    } catch (err: any) {
        if (err.message === 'Timeout') res.status(504).json({ result: 'Model timeout' });
        res.status(500).json({ result: 'Something went wrong' });
    }
});

app.post('/search', async (req, res) => {
    const rawInput = req.body.input as string;
    const input = sanitizeInput(rawInput).trim();
    if (!input || input.length > 500) {
        res.status(400).json({ error: 'Invalid input' });
    }
    try {
        const results = await searchSimilar(input, 15);
        res.json({ results: results.map(r => ({ pageContent: r })), sources: ['search_index'] });
    } catch {
        res.status(500).json({ error: 'Search failed' });
    }
});

app.listen(port, async () => {
    try {
        await initPgvector();
        await initializeDatabase();
        await prepareRAGStore();
        console.log(`🚀 Server listening on port ${port}`);
    } catch (err) {
        console.error('Startup error:', err);
        process.exit(1);
    }
});