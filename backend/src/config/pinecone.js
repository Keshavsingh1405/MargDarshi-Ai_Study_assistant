import { Pinecone } from '@pinecone-database/pinecone';

if (!process.env.PINECONE_API_KEY) {
    throw new Error('CRITICAL ERROR: PINECONE_API_KEY is missing from environment variables. Please check your .env file.');
}

export const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

export const indexName = process.env.PINECONE_INDEX_NAME || 'margdarshi';
