import { ai } from '../../config/gemini.js';

export const generateEmbedding = async (text, retries = 5) => {
    try {
        const response = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: text,
            config: {
                outputDimensionality: 768
            }
        });
        return response.embeddings[0].values;
    } catch (error) {
        if (retries > 0 && (error.status === 429 || error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('503'))) {
            const match = error.message?.match(/retry in ([0-9.]+)s/);
            const waitSec = match ? Math.ceil(parseFloat(match[1])) + 2 : 10;
            console.log(`Embedding rate limit hit, waiting ${waitSec}s before retry...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
            return generateEmbedding(text, retries - 1);
        }
        console.error('Error generating embedding', error);
        throw error;
    }
};

export const generateEmbeddingsBatch = async (texts, retries = 5) => {
    try {
        if (!texts || texts.length === 0) return [];
        
        // Batch in groups of 25 for efficient single-request embedding
        const batchSize = 25;
        const allEmbeddings = [];

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            
            let batchSuccess = false;
            let currentRetries = retries;

            while (!batchSuccess && currentRetries >= 0) {
                try {
                    const response = await ai.models.embedContent({
                        model: 'gemini-embedding-001',
                        contents: batch,
                        config: {
                            outputDimensionality: 768
                        }
                    });
                    
                    if (response.embeddings && response.embeddings.length > 0) {
                        for (const item of response.embeddings) {
                            allEmbeddings.push(item.values);
                        }
                    }
                    batchSuccess = true;
                } catch (err) {
                    if (currentRetries > 0 && (err.status === 429 || err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('503'))) {
                        const match = err.message?.match(/retry in ([0-9.]+)s/);
                        const waitSec = match ? Math.ceil(parseFloat(match[1])) + 3 : 10;
                        console.log(`Rate limit/503 on batch ${i}, waiting ${waitSec}s before retry...`);
                        await new Promise(r => setTimeout(r, waitSec * 1000));
                        currentRetries--;
                    } else {
                        throw err;
                    }
                }
            }
            
            // Brief pause between batches to be gentle on rate limits
            if (i + batchSize < texts.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        
        return allEmbeddings;
    } catch (error) {
        console.error('Error in batch embedding', error);
        throw error;
    }
};
