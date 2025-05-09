export function sanitizeInput(value: string): string {
    return value.replace(/<[^>]*>?/gm, '');
}
