export function buildHumanPrompt(context: string, question: string): string {
    return `CONTEXT:
${context}

QUESTION:
${question}`;
}