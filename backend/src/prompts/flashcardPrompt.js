export const FLASHCARD_PROMPT = `You are Margdarshi, an AI study assistant.
Generate flashcards based on the following context.
Subject: {subject}
Topic: {topic}
Number of flashcards: {count}

CONTEXT:
{context}

Return the response ONLY as a valid JSON object matching this schema without any markdown formatting or \`\`\`json wrappers:
{
  "flashcards": [
    {
      "front": "Question or term",
      "back": "Answer or definition"
    }
  ]
}
`;
