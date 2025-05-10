import pool, {insertEmbeddingsBulk} from "../db/pgvector";
import {isValidContent} from "../helpers/valid-content-check";
import fs from 'fs';
import path from 'path';
import { OpenAIEmbeddings } from '@langchain/openai';
import { parse } from 'csv-parse/sync';
import {batchEmbedInsert} from "./batch-embed-inserter";
import {fileConfigs} from "../helpers/file-config-factory";
import {log} from "../helpers/timestamp-log";
import { Document } from '@langchain/core/documents';


const MAX_DOCS   = Number(process.env.MAX_DOCS  || 25000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1000);
const embedder   = new OpenAIEmbeddings();

export async function prepareRAGStore() {
    log('info', 'Starting RAG store preparation…');
    const { rows } = await pool.query('SELECT COUNT(*) AS c FROM documents');
    const existing = Number(rows[0].c);

    log('info', `${existing} docs already in DB.`);
    if (existing >= MAX_DOCS) {
        log('done', `Reached cap of ${MAX_DOCS} docs—skipping ingest.`);
        return;
    }

    const remaining = MAX_DOCS - existing;
    log('info', `Will ingest up to ${remaining} new docs.`);

    const docs: Document[] = [];
    for (const { path: relPath, factory } of fileConfigs) {
        const src     = path.basename(relPath);
        const raw     = fs.readFileSync(path.resolve(relPath), 'utf-8');
        const records = parse(raw, { columns:true, skip_empty_lines:true, relax_quotes:true, trim:true });

        log('inspect', `Parsing ${src}, ${records.length} rows…`);
        records.forEach(rec => docs.push(...factory(rec, src)));
        log('inspect', `Loaded ${docs.length} docs so far.`);
    }

    console.table(
        fileConfigs.map(({ path: relPath }) => ({
            source: path.basename(relPath),
            validCount: docs.filter(d => d.metadata.name === path.basename(relPath)).length,
        }))
    );

    const ready = docs.filter(d => isValidContent(d.pageContent)).slice(0, remaining);
    const texts = ready.map(d => d.pageContent);
    const metas = ready.map(d => d.metadata);

    await batchEmbedInsert(texts, metas, embedder, insertEmbeddingsBulk, BATCH_SIZE);
}
