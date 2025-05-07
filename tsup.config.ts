import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    outDir: 'build',
    target: 'node18',
    format: ['cjs'],
    clean: true,
});