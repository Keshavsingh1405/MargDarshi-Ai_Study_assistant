import { pc, indexName } from '../../config/pinecone.js';
import { parsePdf } from '../documents/pdfParser.js';
import { parseDocx } from '../documents/docxParser.js';
import { parseTxt } from '../documents/textParser.js';
import { chunkText } from './chunkingService.js';
import { generateEmbeddingsBatch } from '../ai/embeddingService.js';
import Document from '../../models/Document.js';
import crypto from 'crypto';

export const processDocumentJob = async (document, filePath) => {
    try {
        let pages = [];
        
        // 1. Extract Text
        if (document.fileType === 'pdf') {
            pages = await parsePdf(filePath);
        } else if (document.fileType === 'docx') {
            pages = await parseDocx(filePath);
        } else if (document.fileType === 'txt') {
            pages = await parseTxt(filePath);
        } else {
            throw new Error(`Unsupported file type for extraction: ${document.fileType}`);
        }

        // 2. Chunk Text
        const allChunks = [];
        for (const page of pages) {
            const chunks = chunkText(page.text);
            chunks.forEach((chunk, index) => {
                allChunks.push({
                    text: chunk,
                    pageNumber: page.page,
                    chunkIndex: index
                });
            });
        }

        // 3. Generate Embeddings & Upsert to Pinecone in batches
        const index = pc.index(indexName);
        const namespace = index.namespace(document.pineconeNamespace);

        const batchSize = 100;
        let totalProcessed = 0;

        for (let i = 0; i < allChunks.length; i += batchSize) {
            const chunkBatch = allChunks.slice(i, i + batchSize);
            const texts = chunkBatch.map(c => c.text);
            
            const embeddings = await generateEmbeddingsBatch(texts);
            
            const vectors = chunkBatch.map((chunk, idx) => ({
                id: `${document._id}_${chunk.pageNumber}_${chunk.chunkIndex}_${crypto.randomBytes(4).toString('hex')}`,
                values: embeddings[idx],
                metadata: {
                    userId: document.userId.toString(),
                    documentId: document._id.toString(),
                    filename: document.originalName,
                    subject: document.subject,
                    chapter: document.chapter,
                    pageNumber: chunk.pageNumber,
                    chunkIndex: chunk.chunkIndex,
                    text: chunk.text
                }
            }));

            await namespace.upsert(vectors);
            totalProcessed += vectors.length;
        }

        // 4. Update Document Status
        document.status = 'INDEXED';
        document.chunkCount = totalProcessed;
        document.processedAt = new Date();
        await document.save();

        console.log(`Successfully processed document ${document._id}`);
    } catch (error) {
        console.error(`Failed to process document ${document._id}`, error);
        document.status = 'FAILED';
        document.errorMessage = error.message;
        await document.save();
    }
};

export const deleteDocumentVectors = async (pineconeNamespace, documentId) => {
    try {
        if (!pineconeNamespace || !documentId) return;
        const index = pc.index(indexName);
        const namespace = index.namespace(pineconeNamespace);
        const prefix = `${documentId.toString()}_`;
        
        let paginationToken = undefined;
        let totalDeleted = 0;

        do {
            const listRes = await namespace.listPaginated({
                prefix,
                paginationToken
            });
            const vectorIds = (listRes.vectors || []).map(v => v.id).filter(Boolean);
            if (vectorIds.length > 0) {
                for (let i = 0; i < vectorIds.length; i += 100) {
                    const chunk = vectorIds.slice(i, i + 100);
                    await namespace.deleteMany(chunk);
                    totalDeleted += chunk.length;
                }
            }
            paginationToken = listRes.pagination?.next;
        } while (paginationToken);

        console.log(`[Pinecone] Successfully deleted ${totalDeleted} vectors for document ${documentId} in namespace ${pineconeNamespace}`);
    } catch (error) {
        console.error(`[Pinecone] Error deleting vectors for document ${documentId}:`, error.message || error);
    }
};
