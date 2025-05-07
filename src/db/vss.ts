import Database from "better-sqlite3";
import * as sqlite_vss from "sqlite-vss";
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(__dirname, '../../data/rag-vectors.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

export const initVss = async () => {
    sqlite_vss.load(db);

    try {
        const version = db.prepare('SELECT vss_version()').pluck().get();
        console.log('🧩 SQLite VSS version:', version);
    } catch (e) {
        console.warn('⚠️ VSS not initialized yet. Run init-db.ts first.');
    }
};

export default db;
