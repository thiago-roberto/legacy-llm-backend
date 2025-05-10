export function log(level: 'info'|'inspect'|'done', msg: string) {
    const icons = { info: '📚', inspect: '🔍', done: '✅' };
    console.log(`${icons[level]} [${new Date().toISOString()}] ${msg}`);
}