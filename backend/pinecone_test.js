import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function testConnection() {
  try {
    console.log('Fetching indexes...');
    const indexes = await pc.listIndexes();
    console.log('Indexes:', indexes);
  } catch (error) {
    console.error('Connection failed:', error);
  }
}

testConnection();
