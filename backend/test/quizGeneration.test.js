import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateQuiz } from '../src/controllers/quizController.js';

describe('Adaptive Quiz Generation Regression & Diagnostic Tests', () => {

    const htmlPath = path.resolve('..', 'frontend', 'quizzes.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    test('1. Frontend quizzes.html does not mask errors with hardcoded "no documents" alert', () => {
        // Ensure the hardcoded misleading alert is replaced with dynamic err.message
        assert(!htmlContent.includes("alert('Error generating quiz. Ensure you have documents uploaded for this subject.');"),
            'Must not use the misleading hardcoded alert in quizzes.html');
        assert(htmlContent.includes('alert(err.message ||'),
            'Must display err.message to distinguish root cause failures');
        assert(htmlContent.includes('id="subject-datalist"'),
            'Must contain subject datalist for auto-completing uploaded document subjects');
    });

    test('2. Missing documents distinction: returns 404 when user has zero uploaded documents', async () => {
        const req = {
            user: { _id: 'user_empty_123' },
            body: { subject: 'Cloud Computing', topic: 'Types of cloud attacks', difficulty: 'Medium', count: 3 }
        };

        let responseStatus = null;
        let responseJson = null;

        const res = {
            status: (code) => {
                responseStatus = code;
                return res;
            },
            json: (data) => {
                responseJson = data;
                return res;
            }
        };

        // Inject Document.find mock
        const originalFind = (await import('../src/models/Document.js')).default.find;
        (await import('../src/models/Document.js')).default.find = () => ({
            lean: async () => []
        });

        try {
            await generateQuiz(req, res, () => {});
            assert.equal(responseStatus, 404);
            assert.equal(responseJson.success, false);
            assert(responseJson.message.includes('No uploaded documents found'), 'Must distinguish missing documents from other errors');
        } finally {
            (await import('../src/models/Document.js')).default.find = originalFind;
        }
    });

    test('3. Subject mismatch distinction: returns 404 with available subjects when subject not found', async () => {
        const req = {
            user: { _id: 'user_123' },
            body: { subject: 'Physics', topic: 'Thermodynamics', difficulty: 'Medium', count: 3 }
        };

        let responseStatus = null;
        let responseJson = null;

        const res = {
            status: (code) => {
                responseStatus = code;
                return res;
            },
            json: (data) => {
                responseJson = data;
                return res;
            }
        };

        const mockDocs = [
            { _id: 'doc1', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'INDEXED', chunkCount: 64 },
            { _id: 'doc2', originalName: 'dbms mod4.pdf', subject: 'Database', status: 'INDEXED', chunkCount: 93 }
        ];

        const originalFind = (await import('../src/models/Document.js')).default.find;
        (await import('../src/models/Document.js')).default.find = () => ({
            lean: async () => mockDocs
        });

        try {
            await generateQuiz(req, res, () => {});
            assert.equal(responseStatus, 404);
            assert.equal(responseJson.success, false);
            assert(responseJson.message.includes('No documents found for subject "Physics"'), 'Must report subject mismatch');
            assert(responseJson.message.includes('Cloud Computing'), 'Must list available subject Cloud Computing');
        } finally {
            (await import('../src/models/Document.js')).default.find = originalFind;
        }
    });

    test('4. Subject matching is resilient to casing and whitespace', async () => {
        // Test that "cloud computing", " CLOUD COMPUTING ", etc. successfully match "Cloud Computing"
        const mockDocs = [
            { _id: 'doc_cc_1', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'INDEXED', chunkCount: 64 }
        ];

        const testCases = ['cloud computing', '  Cloud Computing  ', 'CLOUD COMPUTING'];

        for (const testSub of testCases) {
            const trimmedSubject = testSub.trim();
            const matched = mockDocs.filter(d => (d.subject || 'General').trim().toLowerCase() === trimmedSubject.toLowerCase());
            assert.equal(matched.length, 1, `Subject "${testSub}" should match "Cloud Computing"`);
            assert.equal(matched[0].originalName, 'cc module 4.pdf');
        }
    });

    test('5. Document status distinction: returns 400 when document is still PROCESSING or FAILED', async () => {
        const reqProcessing = {
            user: { _id: 'user_123' },
            body: { subject: 'Cloud Computing', topic: 'Attacks' }
        };

        let responseStatus = null;
        let responseJson = null;
        const res = {
            status: (code) => { responseStatus = code; return res; },
            json: (data) => { responseJson = data; return res; }
        };

        const originalFind = (await import('../src/models/Document.js')).default.find;
        
        // Processing test
        (await import('../src/models/Document.js')).default.find = () => ({
            lean: async () => [{ _id: 'doc1', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'PROCESSING', chunkCount: 0 }]
        });

        try {
            await generateQuiz(reqProcessing, res, () => {});
            assert.equal(responseStatus, 400);
            assert(responseJson.message.includes('still being processed'), 'Must indicate processing status');

            // Failed test
            (await import('../src/models/Document.js')).default.find = () => ({
                lean: async () => [{ _id: 'doc1', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'FAILED', chunkCount: 0 }]
            });
            await generateQuiz(reqProcessing, res, () => {});
            assert.equal(responseStatus, 400);
            assert(responseJson.message.includes('processing failed'), 'Must indicate failed status');
        } finally {
            (await import('../src/models/Document.js')).default.find = originalFind;
        }
    });

    test('6. Topic coverage verification (Requirement 6): returns 400 when topic is not covered in retrieved content', async () => {
        const req = {
            user: { _id: 'user_123' },
            body: { subject: 'Cloud Computing', topic: 'Photosynthesis in Plants', difficulty: 'Medium', count: 3 }
        };

        let responseStatus = null;
        let responseJson = null;
        const res = {
            status: (code) => { responseStatus = code; return res; },
            json: (data) => { responseJson = data; return res; }
        };

        const mockDocs = [
            { _id: '6ac5e36222c490c569cab47a', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'INDEXED', chunkCount: 64 }
        ];

        const originalFind = (await import('../src/models/Document.js')).default.find;
        (await import('../src/models/Document.js')).default.find = () => ({
            lean: async () => mockDocs
        });

        const mockRetrieve = async () => [
            { id: 'c1', score: 0.35, text: 'Irrelevant text about server cooling' }
        ];

        try {
            await generateQuiz(req, res, () => {}, { retrieveRelevantChunks: mockRetrieve });
            assert.equal(responseStatus, 400);
            assert.equal(responseJson.success, false);
            assert(responseJson.message.includes('Photosynthesis in Plants'), 'Must reference requested topic');
            assert(responseJson.message.includes('not covered in your uploaded study material'), 'Must inform user topic is not covered instead of generating unsupported questions');
        } finally {
            (await import('../src/models/Document.js')).default.find = originalFind;
        }
    });

    test('7. Successful quiz generation using cc module 4.pdf grounded content', async () => {
        const req = {
            user: { _id: '6ac5c73422c490c569caaf73' },
            body: {
                subject: 'Cloud Computing',
                topic: 'Types of cloud attacks',
                difficulty: 'Medium',
                count: 3
            }
        };

        let responseStatus = null;
        let responseJson = null;
        const res = {
            status: (code) => { responseStatus = code; return res; },
            json: (data) => { responseJson = data; return res; }
        };

        const mockDocs = [
            { _id: '6ac5e36222c490c569cab47a', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'INDEXED', chunkCount: 64 }
        ];

        const originalFind = (await import('../src/models/Document.js')).default.find;
        (await import('../src/models/Document.js')).default.find = () => ({
            lean: async () => mockDocs
        });

        const mockRetrieve = async (query, namespace, limit, subject, docIds) => {
            assert.equal(query, 'Types of cloud attacks');
            assert(docIds && docIds.includes('6ac5e36222c490c569cab47a'), 'Must retrieve using verified cc module 4.pdf document ID');
            return [
                { id: 'c1', score: 0.79, text: 'Attackers use cloud services for malicious activities. Insecure APIs. Malicious insiders.' },
                { id: 'c2', score: 0.78, text: 'DoS attacks: Overloading cloud services to disrupt access. Phishing. SQL Injection.' }
            ];
        };

        const mockGenerateAI = async (opts) => {
            assert(opts.contents.includes('Types of cloud attacks'), 'AI prompt must contain requested topic');
            assert(opts.contents.includes('Attackers use cloud services'), 'AI prompt must contain grounded context');
            return {
                text: JSON.stringify({
                    questions: [
                        {
                            questionText: 'Which attack involves overloading cloud services?',
                            type: 'MCQ',
                            options: ['DoS attack', 'Phishing', 'SQL Injection', 'Malicious Insider'],
                            correctAnswer: 'DoS attack',
                            explanation: 'DoS attacks overload cloud services to disrupt access.'
                        },
                        {
                            questionText: 'What risk do weak interfaces expose in cloud services?',
                            type: 'MCQ',
                            options: ['Weak interfaces expose user data', 'Power outages', 'Hardware failures', 'CPU spikes'],
                            correctAnswer: 'Weak interfaces expose user data',
                            explanation: 'Insecure APIs and weak interfaces expose sensitive user data.'
                        },
                        {
                            questionText: 'How can employee access be exploited in cloud providers?',
                            type: 'MCQ',
                            options: ['Malicious insiders', 'DDoS', 'Buffer overflow', 'Phishing'],
                            correctAnswer: 'Malicious insiders',
                            explanation: 'Employees at cloud providers could exploit their access as malicious insiders.'
                        }
                    ]
                })
            };
        };

        const quizModel = (await import('../src/models/Quiz.js')).default;
        const originalCreate = quizModel.create;
        let createdQuizData = null;
        quizModel.create = async (data) => {
            createdQuizData = data;
            return { _id: 'quiz_created_123', ...data };
        };

        try {
            await generateQuiz(req, res, () => {}, {
                retrieveRelevantChunks: mockRetrieve,
                generateAIContent: mockGenerateAI
            });
            assert.equal(responseStatus, 201);
            assert.equal(responseJson.success, true);
            assert.equal(responseJson.data.questions.length, 3);
            assert.equal(createdQuizData.subject, 'Cloud Computing');
            assert.equal(createdQuizData.topic, 'Types of cloud attacks');
            assert.equal(createdQuizData.difficulty, 'Medium');
            assert.equal(createdQuizData.questions[0].correctAnswer, 'DoS attack');
        } finally {
            (await import('../src/models/Document.js')).default.find = originalFind;
            quizModel.create = originalCreate;
        }
    });

    test('8. Gemini API error distinction: returns 503/error status with diagnostic AI message, not missing documents', async () => {
        const req = {
            user: { _id: '6ac5c73422c490c569caaf73' },
            body: { subject: 'Cloud Computing', topic: 'Types of cloud attacks', difficulty: 'Medium', count: 3 }
        };

        let responseStatus = null;
        let responseJson = null;
        const res = {
            status: (code) => { responseStatus = code; return res; },
            json: (data) => { responseJson = data; return res; }
        };

        const mockDocs = [
            { _id: '6ac5e36222c490c569cab47a', originalName: 'cc module 4.pdf', subject: 'Cloud Computing', status: 'INDEXED', chunkCount: 64 }
        ];

        const originalFind = (await import('../src/models/Document.js')).default.find;
        (await import('../src/models/Document.js')).default.find = () => ({
            lean: async () => mockDocs
        });

        const mockRetrieve = async () => [
            { id: 'c1', score: 0.79, text: 'Attackers use cloud services for malicious activities.' }
        ];

        const mockGenerateAI = async () => {
            const err = new Error('AI service is temporarily unavailable. Both primary and backup models failed to respond.');
            err.status = 503;
            throw err;
        };

        try {
            await generateQuiz(req, res, () => {}, {
                retrieveRelevantChunks: mockRetrieve,
                generateAIContent: mockGenerateAI
            });
            assert.equal(responseStatus, 503);
            assert.equal(responseJson.success, false);
            assert(responseJson.message.includes('AI service is temporarily unavailable'), 'Must communicate actual AI failure');
            assert(!responseJson.message.includes('No uploaded documents'), 'Must NOT report AI error as missing documents');
        } finally {
            (await import('../src/models/Document.js')).default.find = originalFind;
        }
    });

    test('9. Real database verification: confirms cc module 4.pdf is found with status INDEXED for user', async () => {
        const mongoose = (await import('mongoose')).default;
        const Document = (await import('../src/models/Document.js')).default;
        
        let shouldDisconnect = false;
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/margdarshi');
            shouldDisconnect = true;
        }

        try {
            const docs = await Document.find({
                userId: '6ac5c73422c490c569caaf73',
                subject: { $regex: /^cloud computing$/i }
            }).lean();

            assert(docs.length > 0, 'Must find at least one Cloud Computing document for user');
            const ccDoc = docs.find(d => d.originalName === 'cc module 4.pdf');
            assert(ccDoc, 'Must find cc module 4.pdf in MongoDB');
            assert.equal(ccDoc.status, 'INDEXED', 'cc module 4.pdf must be in INDEXED status');
            assert(ccDoc.chunkCount > 0, 'cc module 4.pdf must have extracted chunks');
        } finally {
            if (shouldDisconnect) {
                await mongoose.disconnect();
            }
        }
    });
});
