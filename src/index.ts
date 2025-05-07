// index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
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
import {isValidContent} from "./helpers/valid-content-check";

console.log('🔑 OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
const port = 4000;

let vectorStore: MemoryVectorStore;
let searchDocs: Document[] = [];
const embedder = new OpenAIEmbeddings();

async function prepareRAGStore() {
    const docs: Document[] = [];

    const filePaths = [
        'src/datasets/20200325_counsel_chat.csv',
        'src/datasets/counselchat-data.csv',
        'src/datasets/counsel_chat_250-tokens_full.json',
        'src/datasets/4543776.json',
    ];

    for (const file of filePaths) {
        const fullPath = path.resolve(file);
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
            const lines = raw.split('\n').slice(1); // skip header
            for (const line of lines) {
                const parts = line.split(',');
                const questionText = parts[0]?.trim();
                if (questionText) {
                    docs.push(new Document({ pageContent: questionText }));
                }
            }
        }

        console.log(`✔️ done reading: ${file}`);
    }

    console.log(`📄 Total raw documents before splitting: ${docs.length}`);

    const docsToUse = docs.filter((doc) => isValidContent(doc.pageContent)).slice(0, 400).map((doc) => doc.pageContent);

    await insertEmbeddings(docsToUse);

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
    console.time('📦 Splitting documents');
    const splitDocs = await splitter.splitDocuments(docsToUse);
    console.timeEnd('📦 Splitting documents');

    console.time('🧠 Creating vector store');
    vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embedder);
    console.timeEnd('🧠 Creating vector store');

    console.log(`✅ Vector store ready with ${splitDocs.length} chunks`);
}

app.post('/ask', async (req, res) => {
    const input = req.body.input;
    console.log(`📥 Received input: "${input}"`);

    const model = new ChatOpenAI({
        temperature: 0.7,
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    try {
        console.time('🔍 similaritySearch');
        const relevantDocs = await vectorStore.similaritySearch(input, 3);
        console.timeEnd('🔍 similaritySearch');

        const context = relevantDocs.map((doc) => doc.pageContent).join('\n');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        console.log('🧠 Calling OpenAI with context');

        console.time('🧠 model.call');
        const response = await model.call([
            new SystemMessage('You are a mental health assistant. Use the provided context to help answer the question.'),
            new HumanMessage(`Context:\n${context}\n\nUser question: ${input}`),
        ], { signal: controller.signal });
        console.timeEnd('🧠 model.call');

        clearTimeout(timeout);

        console.log('✅ Response received from model');
        res.json({ result: response.text });
    } catch (err: any) {
        clearTimeout(undefined);
        if (err.name === 'AbortError') {
            console.error('❌ Request aborted due to timeout.');
            res.status(504).json({ result: 'The model took too long to respond.' });
        } else {
            console.error('❌ Unexpected error during model call:', err);
            res.status(500).json({ result: 'Something went wrong.' });
        }
    }
});

app.post('/search', async (req, res) => {
    const input = req.body.input;
    if (!input) res.status(400).json({ error: 'Missing input' });

    try {
        const results = await searchSimilar(input, 15);
        res.json({ results: results.map(content => ({ pageContent: content })) });
    } catch (err) {
        console.error('❌ PGVector search failed:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.listen(port, async () => {
    try {
        console.log('🟡 Starting RAG preparation...');
        await initPgvector();
        await initializeDatabase();
        await prepareRAGStore();
        console.log(`✅ LangChain backend listening on port ${port}`);
    } catch (err) {
        console.error('❌ Failed to prepare RAG store:', err);
    }
});
