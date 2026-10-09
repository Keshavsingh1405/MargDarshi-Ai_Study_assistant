import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateAIContent,
    PRIMARY_MODEL,
    BACKUP_MODEL,
    DEFAULT_OPERATION_BUDGET_MS,
    MAX_RETRY_DELAY_BUDGET_MS
} from '../src/services/ai/aiService.js';

const createMockClock = () => {
    let now = 1000;
    return {
        nowFn: () => now,
        advance: (ms) => { now += ms; },
        sleepFn: async (ms) => { now += ms; }
    };
};

describe('AI Service Rescue Fallback & Actionable Error Diagnostics', () => {

    test('1. Rescue candidate is invoked when both primary and backup suffer model-specific quota exhaustion', async () => {
        const calls = [];
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    if (req.model === PRIMARY_MODEL || req.model === BACKUP_MODEL) {
                        const err = new Error(JSON.stringify({
                            error: {
                                code: 429,
                                message: `Quota exceeded for model ${req.model}`,
                                status: 'RESOURCE_EXHAUSTED',
                                details: [
                                    {
                                        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                                        violations: [{ quotaMetric: 'requests_per_model', quotaDimensions: { model: req.model } }]
                                    }
                                ]
                            }
                        }));
                        err.status = 429;
                        throw err;
                    }
                    return { text: 'Successful response from rescue fallback model ' + req.model };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Test prompt for study assistance',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Successful response from rescue fallback model gemini-3.5-flash-lite');
        assert.deepEqual(calls, [PRIMARY_MODEL, BACKUP_MODEL, 'gemini-3.5-flash-lite']);
    });

    test('2. Rescue candidate preserves request config, system instruction, and json mime type', async () => {
        let capturedRescueConfig = null;
        let capturedRescueModel = null;
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    if (req.model === PRIMARY_MODEL || req.model === BACKUP_MODEL) {
                        const err = new Error('Quota exceeded for model ' + req.model);
                        err.status = 429;
                        err.error = { details: [{ reason: 'QUOTA_EXHAUSTED', metadata: { model: req.model } }] };
                        throw err;
                    }
                    capturedRescueModel = req.model;
                    capturedRescueConfig = req.config;
                    return { text: '{"flashcards":[{"front":"Q","back":"A"}]}' };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Generate flashcards',
            config: {
                responseMimeType: 'application/json',
                temperature: 0.3
            },
            systemInstruction: 'You are Margdarshi Flashcard Generator',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(capturedRescueModel, 'gemini-3.5-flash-lite');
        assert.equal(capturedRescueConfig.responseMimeType, 'application/json');
        assert.equal(capturedRescueConfig.temperature, 0.3);
        assert.equal(capturedRescueConfig.systemInstruction, 'You are Margdarshi Flashcard Generator');
        assert(result.text.includes('"flashcards"'));
    });

    test('3. When all configured and candidate models fail quota, returns status 429 and actionable error', async () => {
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    const err = new Error(JSON.stringify({
                        error: {
                            code: 429,
                            message: `Quota exhausted for model ${req.model}`,
                            status: 'RESOURCE_EXHAUSTED',
                            details: [
                                {
                                    '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                                    violations: [{ quotaMetric: 'requests_per_model', quotaDimensions: { model: req.model } }]
                                }
                            ]
                        }
                    }));
                    err.status = 429;
                    throw err;
                }
            }
        };

        const clock = createMockClock();
        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 429, 'Status must be 429 on quota exhaustion');
                assert.equal(err.category, 'QUOTA_EXHAUSTED');
                assert.match(err.message, /quota exceeded/i);
                assert.match(err.message, /daily free-tier/i);
                return true;
            }
        );
    });

    test('4. Operation budget default is 30,000ms while MAX_RETRY_DELAY_BUDGET_MS remains 15,000ms', () => {
        assert.equal(MAX_RETRY_DELAY_BUDGET_MS, 15000);
        assert.equal(DEFAULT_OPERATION_BUDGET_MS, 30000);
    });

    test('5. Transient rate limit returns status 429 with actionable rate limit message', async () => {
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    const err = new Error('Too many requests per minute');
                    err.status = 429;
                    err.statusText = 'RESOURCE_EXHAUSTED';
                    throw err;
                }
            }
        };

        const clock = createMockClock();
        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient,
                    budgetMs: 1000, // Small budget to trigger budget exit quickly
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 429);
                assert.match(err.message, /rate limit/i);
                return true;
            }
        );
    });
});
