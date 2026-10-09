import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import Document from '../src/models/Document.js';
import { sendMessage } from '../src/controllers/chatController.js';

describe('AI Tutor / Chat Verification and Error Handling Tests', () => {
    let user1Id;
    let user2Id;
    let testChat;
    let testDoc;

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI);
        }
        user1Id = new mongoose.Types.ObjectId();
        user2Id = new mongoose.Types.ObjectId();

        testChat = await Chat.create({
            userId: user1Id,
            title: 'New Conversation',
            documents: []
        });

        testDoc = await Document.create({
            userId: user1Id,
            filename: 'test_doc.pdf',
            originalName: 'Operating Systems Notes.pdf',
            fileType: 'pdf',
            fileSize: 1024,
            subject: 'Computer Science',
            status: 'INDEXED',
            chunkCount: 3,
            pineconeNamespace: `user_${user1Id}`
        });
    });

    after(async () => {
        if (testChat) await Chat.deleteOne({ _id: testChat._id });
        if (testDoc) await Document.deleteOne({ _id: testDoc._id });
        await Message.deleteMany({ chatId: testChat._id });
        await Chat.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await mongoose.disconnect();
    });

    test('1. Empty or missing message content returns 400', async () => {
        const req = {
            user: { _id: user1Id },
            body: { chatId: testChat._id, content: '   ' }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await sendMessage(req, res, () => {});
        assert.equal(statusCode, 400);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /Message content is required/);
    });

    test('2. User isolation: User 2 cannot access or send messages in User 1 chat', async () => {
        const req = {
            user: { _id: user2Id }, // Different user
            body: { chatId: testChat._id, content: 'What is a process?' }
        };
        let errorThrown = null;
        const res = {
            status: () => res,
            json: () => {}
        };
        const next = (err) => { errorThrown = err; };

        await sendMessage(req, res, next);
        assert(errorThrown, 'Should throw error for unauthorized chat access');
        assert.match(errorThrown.message, /Chat not found/);
    });

    test('3. AI service failure does NOT save fake AI message and returns 503', async () => {
        const req = {
            user: { _id: user1Id },
            body: { chatId: testChat._id, content: 'Explain deadlock conditions.' }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        const mockFailingAI = async () => {
            const err = new Error('AI service is temporarily unavailable. Both primary and backup models failed to respond.');
            err.status = 503;
            err.category = 'SERVER_UNAVAILABLE';
            throw err;
        };

        await sendMessage(req, res, () => {}, {
            generateAIContent: mockFailingAI
        });

        assert.equal(statusCode, 503);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /AI service is temporarily unavailable/);

        // Verify NO fake AI message was persisted in MongoDB
        const aiMessages = await Message.find({ chatId: testChat._id, role: 'ai' });
        assert.equal(aiMessages.length, 0, 'No AI message should be saved on model failure');
    });

    test('4. Successful AI generation persists user and AI messages and returns sources', async () => {
        const freshChat = await Chat.create({
            userId: user1Id,
            title: 'New Conversation',
            documents: []
        });

        const req = {
            user: { _id: user1Id },
            body: {
                chatId: freshChat._id,
                content: 'What is virtual memory?',
                contextMode: 'selected',
                documentIds: [testDoc._id.toString()]
            }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        const mockRetrieval = async () => [
            {
                id: 'chunk_1',
                score: 0.82,
                documentId: testDoc._id.toString(),
                filename: testDoc.originalName,
                pageNumber: 4,
                text: 'Virtual memory is a memory management capability of an operating system.'
            }
        ];

        const mockSuccessAI = async () => ({
            text: 'Virtual memory creates the illusion of a very large main memory for executing programs.'
        });

        await sendMessage(req, res, () => {}, {
            retrieveRelevantChunks: mockRetrieval,
            generateAIContent: mockSuccessAI
        });

        assert.equal(statusCode, 200);
        assert.equal(responseJson.success, true);
        assert.match(responseJson.data.answer, /Virtual memory/);
        assert.equal(responseJson.data.sources.length, 1);
        assert.equal(responseJson.data.sources[0].documentName, testDoc.originalName);

        // Verify messages in MongoDB
        const persistedAiMsg = await Message.findOne({ chatId: freshChat._id, role: 'ai' });
        assert(persistedAiMsg, 'AI message must be saved');
        assert.equal(persistedAiMsg.content, responseJson.data.answer);

        // Verify Chat title updated from 'New Conversation'
        const updatedChat = await Chat.findById(freshChat._id);
        assert.notEqual(updatedChat.title, 'New Conversation');

        await Message.deleteMany({ chatId: freshChat._id });
        await Chat.deleteOne({ _id: freshChat._id });
    });

    test('5. Zero documents selected in selected mode answers without fabricating document sources', async () => {
        let sentPrompt = '';
        const req = {
            user: { _id: user1Id },
            body: {
                chatId: testChat._id,
                content: 'Explain binary trees.',
                contextMode: 'selected',
                documentIds: []
            }
        };
        let responseJson = null;
        const res = {
            status: () => res,
            json: (data) => { responseJson = data; }
        };

        const mockAI = async ({ contents }) => {
            sentPrompt = contents;
            return { text: 'A binary tree is a hierarchical data structure.' };
        };

        await sendMessage(req, res, () => {}, {
            generateAIContent: mockAI
        });

        assert.equal(responseJson.success, true);
        assert.equal(responseJson.data.sources.length, 0, 'Sources must be empty when no documents are selected');
        assert(sentPrompt.includes('0 documents selected'), 'Prompt must instruct model that 0 documents were selected');
    });
});
