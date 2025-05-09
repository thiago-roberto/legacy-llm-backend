// index.ts
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
import { extractStringsFromJSON } from './helpers/json-parser';
import {insertEmbeddings, initPgvector, searchSimilar} from './db/pgvector';
import { initializeDatabase } from './scripts/init-db';
import { isValidContent } from './helpers/valid-content-check';
import { sanitizeInput } from './helpers/sanitize-input';
dotenv.config();

const app = express();
const port = 4000;

app.use(cors({ origin: ['https://aquamarine-cajeta-dc7dc7.netlify.app/', 'http://localhost:3000'] }));
app.use(express.json());

let vectorStore: MemoryVectorStore;
const embedder = new OpenAIEmbeddings();

async function prepareRAGStore() {
    console.log(`📚 [${new Date().toISOString()}] Starting RAG store preparation...`);
    const docs: Document[] = [];
    const filePaths = [
        'src/datasets/20200325_counsel_chat.csv',
        'src/datasets/counselchat-data.csv',
        'src/datasets/counsel_chat_250-tokens_full.json',
        'src/datasets/4543776.json',
    ];

    for (const file of filePaths) {
        const fullPath = path.resolve(file);
        console.log(`🔍 [${new Date().toISOString()}] Loading file: ${fullPath}`);
        const ext = path.extname(file);
        const raw = fs.readFileSync(fullPath, 'utf-8');

        if (ext === '.json') {
            const json = JSON.parse(raw);
            if (Array.isArray(json)) {
                json.forEach((entry: any) => {
                    if (entry.text) {
                        docs.push(new Document({ pageContent: entry.text }));
                    }
                });
            } else if (typeof json === 'object' && json !== null) {
                for (const [key, value] of Object.entries(json)) {
                    if (typeof value === 'string') {
                        docs.push(new Document({ pageContent: `${key}: ${value}` }));
                    } else if (Array.isArray(value)) {
                        value.forEach((item) => {
                            if (typeof item === 'string') {
                                docs.push(new Document({ pageContent: `${key}: ${item}` }));
                            } else if (typeof item === 'object' && item !== null) {
                                const extracted = extractStringsFromJSON(item);
                                extracted.forEach((text) => {
                                    docs.push(new Document({ pageContent: text }));
                                });
                            }
                        });
                    } else if (typeof value === 'object' && value !== null) {
                        const extracted = extractStringsFromJSON(value);
                        extracted.forEach((text) => {
                            docs.push(new Document({ pageContent: text }));
                        });
                    }
                }
            }
        } else if (ext === '.csv') {
            const lines = raw.split('\n').slice(1);
            for (const line of lines) {
                const parts = line.split(',');
                const questionText = parts[0]?.trim();
                if (questionText) {
                    docs.push(new Document({ pageContent: questionText }));
                }
            }
        }
    }

    console.log(`✂️ [${new Date().toISOString()}] Filtering and splitting documents...`);
    const docsToUse = docs
        .filter((doc) => isValidContent(doc.pageContent))
        .slice(0, 400)
        .map((doc) => doc.pageContent);

    console.log(`⚙️ [${new Date().toISOString()}] Inserting embeddings into vector store...`);
    await insertEmbeddings(docsToUse);

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
    const splitDocs = await splitter.splitDocuments(docsToUse);

    console.log(`🔗 [${new Date().toISOString()}] Building in-memory MemoryVectorStore...`);
    vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embedder);

    console.log(`✅ [${new Date().toISOString()}] RAG store preparation complete.`);
}

app.post('/ask', async (req, res) => {
    const rawInput = req.body.input as string;
    const input = sanitizeInput(rawInput).trim();
    console.log(`💬 [${new Date().toISOString()}] Received /ask request with input: ${input}`);

    const model = new ChatOpenAI({
        temperature: 0.7,
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    try {
        const relevantDocs = await vectorStore.similaritySearch(input, 3);
        console.log(`🔍 [${new Date().toISOString()}] Retrieved ${relevantDocs.length} relevant docs.`);

        const context = relevantDocs.map((doc) => doc.pageContent).join('\n');
        const callPromise = model.call([
            new SystemMessage('You are a mental health assistant. Use the provided context to help answer the question.'),
            new HumanMessage(`Context:\n${context}\n\nUser question: ${input}`),
        ]);

        const response = await withTimeout(callPromise, 10000);
        console.log(`✅ [${new Date().toISOString()}] Model responded successfully.`);
        res.json({ result: response.text });
    } catch (err: any) {
        console.error(`❌ [${new Date().toISOString()}] Error in /ask:`, err);
        if (err.message === 'Timeout') {
            res.status(504).json({ result: 'The model took too long to respond.' });
        } else {
            res.status(500).json({ result: 'Something went wrong.' });
        }
    }
});

app.post('/search', async (req, res) => {
    const rawInput = req.body.input as string;
    const input = sanitizeInput(rawInput).trim();
    console.log(`🔎 [${new Date().toISOString()}] Received /search request with input: ${input}`);

    if (!input || input.trim().length === 0 || input.trim().length > 500) {
        console.warn(`⚠️  [${new Date().toISOString()}] Invalid input in /search.`);
        res.status(400).json({ error: 'Invalid input' });
        return;
    }

    try {
        const results = await searchSimilar(input, 15);
        console.log(`📈 [${new Date().toISOString()}] Returning ${results.length} search results.`);
        res.json({ results: results.map((content) => ({ pageContent: content })) });
    } catch (err) {
        console.error(`❌ [${new Date().toISOString()}] Error in /search:`, err);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Start server and initialize resources
app.listen(port, async () => {
    console.log(`🚀 Server listening on port ${port}`);
    try {
        console.log(`Initializing pgvector...`);
        await initPgvector();
        console.log(`🗄️  [${new Date().toISOString()}] Initializing database...`);
        await initializeDatabase();

        await prepareRAGStore();
    } catch (err) {
        console.error(`🔥 Startup error:`, err);
    }
});
