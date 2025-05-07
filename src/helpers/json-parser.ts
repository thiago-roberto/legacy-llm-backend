export function extractStringsFromJSON(value: any): string[] {
    const results: string[] = [];

    if (typeof value === 'string') {
        results.push(value);
    } else if (Array.isArray(value)) {
        value.forEach((item) => {
            results.push(...extractStringsFromJSON(item));
        });
    } else if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach((val) => {
            results.push(...extractStringsFromJSON(val));
        });
    }

    return results;
}