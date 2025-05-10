import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import {initPgvector, searchSimilar} from './db/pgvector';
import { initializeDatabase } from './scripts/init-db';
import { sanitizeInput } from './helpers/sanitize-input';
import { withTimeout } from './helpers/timeout';
import { docAssistantPrompt } from './prompts/doc-assistant-prompt';
import { buildHumanPrompt } from './prompts/build-human-prompt';
import {prepareRAGStore} from "./scripts/prepare-rag-store";
import {mmrSearch} from "./db/retriever";

dotenv.config();

const app = express();
const port = 4000;

app.use(cors({
    origin: ['https://aquamarine-cajeta-dc7dc7.netlify.app', 'http://localhost:3000'],
}));
app.use(express.json());

app.post('/ask', async (req, res) => {
    const rawInput = req.body.input as string;
    const input = sanitizeInput(rawInput).trim();
    if (!input || input.length > 500) {
        res.status(400).json({ error: 'Invalid input' });
    }
    const model = new ChatOpenAI({ temperature: 0.7, openAIApiKey: process.env.OPENAI_API_KEY });
    try {
        const relevantDocs = await mmrSearch(input);
        const sources = relevantDocs.map(r => r.metadata.name);
        const context = relevantDocs
            .map(r => `[${r.metadata.name}] ${r.content}`)
            .join('\n');

        const response = await withTimeout(
            model.call([
                new SystemMessage(docAssistantPrompt),
                new HumanMessage(buildHumanPrompt(context, input)),
            ]),
            10000
        );
        const uniqueSources = Array.from(new Set(sources))

        res.json({
            result: response.text,
            sources: uniqueSources
        });
    } catch (err: any) {
        console.log(err);
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
        const results = await mmrSearch(input);
        res.json({ results: results.map(r => ({ pageContent: r.pageContent, source: r.metadata.name }))});
    } catch (err) {
        console.log(err);
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