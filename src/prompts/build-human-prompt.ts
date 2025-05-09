export function buildHumanPrompt(context: string, question: string): string {
    return `CONTEXT:
${context}

QUESTION:
${question}

INSTRUCTIONS:
- You are a doctor’s assistant.
- Base your response *only* on the CONTEXT.
- Provide concise, professional, evidence-based advice.
- When you refer to a document, call it “Doc A”, “Doc B”, etc.`;
}