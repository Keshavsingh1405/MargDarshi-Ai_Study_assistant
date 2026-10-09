export const QUIZ_PROMPT = `You are Margdarshi, an AI study assistant.
Generate a quiz based on the following context.
Topic: {topic}
Difficulty: {difficulty}
Number of questions: {count}
Question Type: {type}

CONTEXT:
{context}

Return the response ONLY as a valid JSON object matching this schema without any markdown formatting or \`\`\`json wrappers:
{
  "questions": [
    {
      "questionText": "Question string",
      "type": "MCQ",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "The correct option exactly as written",
      "explanation": "Explanation of the correct answer"
    }
  ]
}
`;
