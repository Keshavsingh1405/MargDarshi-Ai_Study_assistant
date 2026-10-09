import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Document from '../models/Document.js';
import { retrieveRelevantChunks } from '../services/rag/retrievalService.js';
import { generateAIContent, sanitizeLogString } from '../services/ai/aiService.js';
import { RAG_PROMPT } from '../prompts/ragPrompt.js';

export const createChat = async (req, res, next) => {
    try {
        const chat = await Chat.create({
            userId: req.user._id,
            title: req.body.title || 'New Conversation',
            documents: req.body.documents || []
        });
        res.status(201).json({ success: true, data: chat });
    } catch (error) {
        next(error);
    }
};

export const getChats = async (req, res, next) => {
    try {
        const chats = await Chat.find({ userId: req.user._id }).sort({ updatedAt: -1 });
        res.json({ success: true, data: chats });
    } catch (error) {
        next(error);
    }
};

export const getChatById = async (req, res, next) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.id, userId: req.user._id });
        if (!chat) {
            res.status(404);
            throw new Error('Chat not found');
        }
        const messages = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 });
        res.json({ success: true, data: { chat, messages } });
    } catch (error) {
        next(error);
    }
};

export const deleteChat = async (req, res, next) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.id, userId: req.user._id });
        if (!chat) {
            res.status(404);
            throw new Error('Chat not found');
        }
        await Message.deleteMany({ chatId: chat._id });
        await chat.deleteOne();
        res.json({ success: true, message: 'Chat deleted' });
    } catch (error) {
        next(error);
    }
};

export const sendMessage = async (req, res, next, services = {}) => {
    try {
        const { chatId, content, documentIds, contextMode } = req.body;
        const retriever = services.retrieveRelevantChunks || retrieveRelevantChunks;
        const aiGenerator = services.generateAIContent || generateAIContent;

        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Message content is required.'
            });
        }

        const trimmedContent = content.trim();
        
        const chat = await Chat.findOne({ _id: chatId, userId: req.user._id });
        if (!chat) {
            res.status(404);
            throw new Error('Chat not found');
        }

        // 1. Save user message
        await Message.create({
            chatId,
            role: 'user',
            content: trimmedContent
        });

        const namespace = `user_${req.user._id}`;
        let targetDocumentIds = null;
        let contextString = '';
        const sources = [];

        // Check if user is in "selected" mode or has provided specific documentIds
        const isSelectedMode = (contextMode === 'selected') || (Array.isArray(documentIds) && contextMode !== 'all');

        if (isSelectedMode) {
            if (Array.isArray(documentIds) && documentIds.length > 0) {
                // Validate that every document ID belongs to the authenticated user
                const validDocs = await Document.find({
                    _id: { $in: documentIds },
                    userId: req.user._id
                }).select('_id originalName');

                targetDocumentIds = validDocs.map(d => d._id.toString());
            } else {
                targetDocumentIds = [];
            }
        }

        // 2. Handle context retrieval based on selection
        if (isSelectedMode && targetDocumentIds.length === 0) {
            // Zero documents selected in Selected Documents mode.
            // Do NOT retrieve chunks or claim document context.
            contextString = '';
        } else {
            // Retrieve relevant chunks from Pinecone with documentIds filter
            const chunks = await retriever(trimmedContent, namespace, 5, null, targetDocumentIds);

            // Double check: if targetDocumentIds is specified, ensure chunks only match those documentIds
            const filteredChunks = targetDocumentIds 
                ? chunks.filter(c => c.documentId && targetDocumentIds.includes(c.documentId.toString()))
                : chunks;

            const seenSources = new Set();
            filteredChunks.forEach((chunk, i) => {
                contextString += `[Source ${i+1}] Document: ${chunk.filename} (Page ${chunk.pageNumber})\n${chunk.text}\n\n`;
                const sourceKey = `${chunk.documentId || chunk.filename}_${chunk.pageNumber}`;
                if (!seenSources.has(sourceKey)) {
                    seenSources.add(sourceKey);
                    sources.push({
                        documentId: chunk.documentId,
                        documentName: chunk.filename,
                        page: chunk.pageNumber,
                        excerpt: chunk.text.substring(0, 100) + '...'
                    });
                }
            });

            // Update chat document references if specific documents were selected
            if (targetDocumentIds && targetDocumentIds.length > 0) {
                chat.documents = targetDocumentIds;
                await chat.save();
            }
        }

        // 3. Generate Answer using Gemini
        let answerText = '';
        try {
            let prompt;
            if (isSelectedMode && targetDocumentIds.length === 0) {
                prompt = `You are Margdarshi, an AI study assistant.
The student has set Context Mode to "Selected Documents", but currently has 0 documents selected.
Please provide a helpful, clear, and educational answer to their question using general knowledge. In your answer, clearly note that no document was selected as context, so this response is not based on their specific course materials.

STUDENT QUESTION: ${trimmedContent}`;
            } else {
                prompt = RAG_PROMPT.replace('{context}', contextString || 'None').replace('{question}', trimmedContent);
            }

            const response = await aiGenerator({
                contents: prompt
            });

            if (!response || !response.text) {
                return res.status(503).json({
                    success: false,
                    message: 'AI service returned an empty response. Please try again.'
                });
            }
            answerText = response.text;
        } catch (error) {
            const sanitizedMsg = sanitizeLogString(error?.message || 'Unknown error');
            console.error(
                `[Chat Controller] Gemini answer generation failed ` +
                `(Status: ${error?.status || 'N/A'}, Category: ${error?.category || 'UNKNOWN'}, Scope: ${error?.scope || 'UNKNOWN'}): ${sanitizedMsg}`
            );
            const status = error.status || (error.category === 'RATE_LIMIT' ? 429 : 503);
            return res.status(status).json({
                success: false,
                message: error.message || 'AI service is temporarily unavailable. Please try again.'
            });
        }

        // 4. Save AI message (only after successful generation)
        const aiMessage = await Message.create({
            chatId,
            role: 'ai',
            content: answerText,
            sources
        });

        // Update chat title if it's the first message
        const messageCount = await Message.countDocuments({ chatId });
        if (messageCount <= 2 && chat.title === 'New Conversation') {
            chat.title = trimmedContent.substring(0, 30) + (trimmedContent.length > 30 ? '...' : '');
            await chat.save();
        }

        res.json({
            success: true,
            data: {
                answer: answerText,
                sources,
                chatId
            }
        });

    } catch (error) {
        next(error);
    }
};


