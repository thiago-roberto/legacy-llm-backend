export function buildHumanPrompt(context: string, question: string): string {
    return `CONTEXT:
${context}

QUESTION:
${question}

INSTRUCTIONS:
- You are a doctor’s assistant.
- Base your response *only* on the CONTEXT.
- Provide concise, professional, evidence-based advice.
- When you refer to a document, call it “Doc A”, “Doc B”, etc., 
  where A and B is the actual document name. If the document does not have a name, provide any possible details about it.
- Use the provided CONTEXT to generate professional, evidence-based advice. 
- Always base your answer on the retrieved documents, and never offer off-scope responses.
- If the question is off-scope, reinforce you can not assist.`;
}