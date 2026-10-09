import { pc, indexName } from '../../config/pinecone.js';
import { generateEmbedding } from '../ai/embeddingService.js';

export const retrieveRelevantChunks = async (query, namespace, topK = 5, subjectFilter = null, documentIds = null) => {
    try {
        const queryEmbedding = await generateEmbedding(query);
        
        const index = pc.index(indexName);
        const ns = index.namespace(namespace);
        
        let filter = undefined;
        let docIdStrings = null;

        if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
            docIdStrings = documentIds.map(id => id.toString());
            if (docIdStrings.length === 1) {
                filter = { documentId: docIdStrings[0] };
            } else {
                filter = { documentId: { $in: docIdStrings } };
            }
            if (subjectFilter) {
                filter.subject = subjectFilter;
            }
        } else if (subjectFilter) {
            filter = { subject: subjectFilter };
        }
        
        const results = await ns.query({
            vector: queryEmbedding,
            topK,
            includeMetadata: true,
            filter
        });
        
        let matches = (results.matches || []).map(match => ({
            id: match.id,
            score: match.score,
            documentId: match.metadata?.documentId,
            filename: match.metadata?.filename,
            pageNumber: match.metadata?.pageNumber,
            text: match.metadata?.text
        }));

        // Strict verification: ensure returned chunks match requested document IDs if specified
        if (docIdStrings && docIdStrings.length > 0) {
            matches = matches.filter(m => m.documentId && docIdStrings.includes(m.documentId.toString()));
        }

        return matches;
    } catch (error) {
        console.warn('Pinecone retrieval warning (falling back to empty context):', error.message || error);
        return [];
    }
};
