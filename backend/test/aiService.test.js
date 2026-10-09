import 'dotenv/config';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateAIContent,
    PRIMARY_MODEL,
    BACKUP_MODEL,
    MAX_PRIMARY_RETRIES,
    MAX_BACKUP_RETRIES,
    MAX_RETRY_DELAY_BUDGET_MS,
    BudgetTracker,
    parseErrorDetails,
    classifyError,
    computeBackoffMs,
    sanitizeLogString,
    mergeGenerationConfig
} from '../src/services/ai/aiService.js';
import { indexName } from '../src/config/pinecone.js';
import { RAG_PROMPT } from '../src/prompts/ragPrompt.js';

// Helper for deterministic mock clock and sleep
const createMockClock = () => {
    let now = 1000;
    return {
        nowFn: () => now,
        advance: (ms) => { now += ms; },
        sleepFn: async (ms) => { now += ms; }
    };
};

describe('AI Service Controlled Fallback & Retry Tests', () => {

    test('1. Primary success without fallback', async () => {
        const calls = [];
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req);
                    return { text: 'Primary model success response' };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Test prompt',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Primary model success response');
        assert.equal(calls.length, 1, 'Should call API exactly once');
        assert.equal(calls[0].model, PRIMARY_MODEL, `Should use primary model ${PRIMARY_MODEL}`);
    });

    test('2. Primary transient failure followed by successful retry', async () => {
        const calls = [];
        let attempts = 0;
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    attempts++;
                    if (attempts <= 2) {
                        const err = new Error('Service Unavailable');
                        err.status = 503;
                        throw err;
                    }
                    return { text: 'Recovered on attempt 3' };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Test prompt',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Recovered on attempt 3');
        assert.equal(calls.length, 3, 'Should attempt primary model 3 times (1 initial + 2 retries)');
        assert.deepEqual(calls, [PRIMARY_MODEL, PRIMARY_MODEL, PRIMARY_MODEL]);
    });

    test('3. Primary retries exhausted, followed by successful backup', async () => {
        const calls = [];
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    if (req.model === PRIMARY_MODEL) {
                        const err = new Error('503 Server Busy');
                        err.status = 503;
                        throw err;
                    }
                    return { text: 'Backup model response' };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Test prompt',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Backup model response');
        assert.equal(calls.length, 4);
        assert.deepEqual(calls, [
            PRIMARY_MODEL,
            PRIMARY_MODEL,
            PRIMARY_MODEL,
            BACKUP_MODEL
        ]);
    });

    test('4. Permanent errors do not trigger inappropriate retries or fallback', async () => {
        // 400 Invalid Argument
        const calls400 = [];
        const mockClient400 = {
            models: {
                generateContent: async (req) => {
                    calls400.push(req.model);
                    const err = new Error('Bad Request: Invalid parameter');
                    err.status = 400;
                    throw err;
                }
            }
        };

        const clock = createMockClock();
        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient400,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 400);
                assert.equal(err.category, 'INVALID_ARGUMENT');
                return true;
            }
        );
        assert.equal(calls400.length, 1, '400 must fail immediately with 0 retries and no fallback');

        // 401 Unauthorized
        const calls401 = [];
        const mockClient401 = {
            models: {
                generateContent: async (req) => {
                    calls401.push(req.model);
                    const err = new Error('API key not valid');
                    err.status = 401;
                    throw err;
                }
            }
        };

        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient401,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 401);
                assert.equal(err.category, 'AUTH_ERROR');
                return true;
            }
        );
        assert.equal(calls401.length, 1, '401 must fail immediately with 0 retries and no fallback');

        // 403 Forbidden
        const calls403 = [];
        const mockClient403 = {
            models: {
                generateContent: async (req) => {
                    calls403.push(req.model);
                    const err = new Error('Permission denied');
                    err.status = 403;
                    throw err;
                }
            }
        };

        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient403,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 403);
                assert.equal(err.category, 'AUTH_ERROR');
                return true;
            }
        );
        assert.equal(calls403.length, 1, '403 must fail immediately with 0 retries and no fallback');

        // 404 Model Not Found triggers backup model with 0 retries on primary
        const calls404 = [];
        const mockClient404 = {
            models: {
                generateContent: async (req) => {
                    calls404.push(req.model);
                    if (req.model === PRIMARY_MODEL) {
                        const err = new Error('models/gemini-3.7-flash not found');
                        err.status = 404;
                        throw err;
                    }
                    return { text: 'Backup model responded after 404' };
                }
            }
        };

        const result404 = await generateAIContent({
            contents: 'Test prompt',
            client: mockClient404,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });
        assert.equal(result404.text, 'Backup model responded after 404');
        assert.deepEqual(calls404, [PRIMARY_MODEL, BACKUP_MODEL], '404 should trigger backup with 0 retries on primary');
    });

    test('5. Model-specific quota exhaustion follows the approved fallback policy', async () => {
        const calls = [];
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    if (req.model === PRIMARY_MODEL) {
                        const err = new Error('Quota exceeded for model gemini-3.7-flash');
                        err.status = 429;
                        err.error = {
                            details: [
                                {
                                    reason: 'QUOTA_EXHAUSTED',
                                    metadata: { quota_metric: 'GenerateContentRequestsPerMinutePerModel', model: 'gemini-3.7-flash' }
                                }
                            ]
                        };
                        throw err;
                    }
                    return { text: 'Backup model succeeded after model-specific quota exhaustion' };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Test prompt',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Backup model succeeded after model-specific quota exhaustion');
        // Primary: 1 attempt (0 retries because quota is confirmed exhausted on primary)
        // Backup: 1 attempt
        assert.equal(calls.length, 2);
        assert.deepEqual(calls, [PRIMARY_MODEL, BACKUP_MODEL]);
    });

    test('6. Project-wide and unknown-scope quota errors follow the intended safe policy', async () => {
        // Project-wide quota error
        const callsProject = [];
        const mockClientProject = {
            models: {
                generateContent: async (req) => {
                    callsProject.push(req.model);
                    const err = new Error('Quota exceeded for project');
                    err.status = 429;
                    err.error = {
                        details: [
                            { reason: 'QUOTA_EXHAUSTED', metadata: { quota_metric: 'GenerateContentRequestsPerDayPerProject' } }
                        ]
                    };
                    throw err;
                }
            }
        };

        const clock = createMockClock();
        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClientProject,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.category, 'QUOTA_EXHAUSTED');
                return true;
            }
        );
        assert.equal(callsProject.length, 1, 'Project-wide quota error must not retry or fall back');

        // Unknown scope quota error
        const callsUnknown = [];
        const mockClientUnknown = {
            models: {
                generateContent: async (req) => {
                    callsUnknown.push(req.model);
                    const err = new Error('Daily quota exceeded: unknown quota limit 0');
                    err.status = 429;
                    err.error = { details: [{ reason: 'QUOTA_EXHAUSTED' }] };
                    throw err;
                }
            }
        };

        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClientUnknown,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.category, 'QUOTA_EXHAUSTED');
                return true;
            }
        );
        assert.equal(callsUnknown.length, 1, 'Unknown scope quota error must not retry or fall back');
    });

    test('7. Retry-After and Google RetryInfo delays are respected', () => {
        // Numeric seconds
        const parsedSec = parseErrorDetails({
            status: 429,
            response: { headers: { get: (h) => (h === 'retry-after' ? '5' : null) } }
        });
        assert.equal(parsedSec.retryAfterMs, 5000);

        // HTTP-Date with deterministic reference time
        const fixedNow = 1700000000000;
        const targetDate = new Date(fixedNow + 8000).toUTCString();
        const parsedDate = parseErrorDetails({
            status: 429,
            response: { headers: { get: (h) => (h === 'retry-after' ? targetDate : null) } }
        }, fixedNow);
        assert.equal(parsedDate.retryAfterMs, 8000, 'HTTP-date should parse to exact delta from fixed reference time');

        // Google RetryInfo RPC format
        const parsedRpc = parseErrorDetails({
            status: 429,
            error: {
                details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3.5s' }]
            }
        });
        assert.equal(parsedRpc.retryAfterMs, 3500);

        // Delay must never be earlier than server specified delay
        const delay = computeBackoffMs(0, 3000, 500, 5000, 10000);
        assert(delay >= 3000, 'Calculated delay must be >= server-specified delay');
    });

    test('8. A retry delay larger than the remaining budget stops further attempts', () => {
        const remainingBudget = 5000;
        // Server delay is 10s, which is greater than 5s remaining budget
        const delay = computeBackoffMs(0, 10000, 500, 5000, remainingBudget);
        assert.equal(delay, null, 'Delay exceeding remaining budget must return null');
    });

    test('9. Request execution time is accounted for in the shared budget', async () => {
        const calls = [];
        const clock = createMockClock();
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    // Each request takes 6,000ms
                    clock.advance(6000);
                    const err = new Error('503 Server Busy');
                    err.status = 503;
                    throw err;
                }
            }
        };

        // Budget is 15,000ms.
        // Attempt 1: 6,000ms elapsed. Remaining = 9,000ms.
        // Sleep 1: ~600ms elapsed. Remaining = ~8,400ms.
        // Attempt 2: 6,000ms elapsed. Remaining = ~2,400ms.
        // Sleep 2: exponential backoff ~1,100ms. Remaining = ~1,300ms.
        // Attempt 3: 6,000ms elapsed -> Budget exhausted (19,000+ms elapsed)!
        // Primary exhausted, remaining budget <= 0 -> Backup model cannot be started!
        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient,
                    budgetMs: 15000,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 504);
                assert.equal(err.category, 'DEADLINE_EXCEEDED');
                return true;
            }
        );

        // Backup model must never have been called because budget expired during primary calls
        assert(calls.every(m => m === PRIMARY_MODEL), 'Only primary model was called before budget expired');
        assert.equal(calls.length, 3, 'All 3 primary attempts ran before budget exhausted, leaving no budget for backup');
    });

    test('10. Retry jitter cannot push a delay beyond the remaining budget', () => {
        // Deterministic boundary test: randomFn returns maximum jitter (0.9999)
        const maxRandomFn = () => 0.9999;
        const delayMaxJitter = computeBackoffMs(0, 3000, 500, 5000, 3050, maxRandomFn);
        assert(delayMaxJitter !== null);
        assert(delayMaxJitter >= 3000, 'Delay must be at least server-specified delay 3000ms');
        assert(delayMaxJitter <= 3050, 'Delay with max jitter must not exceed remaining budget 3050ms');

        // Deterministic boundary test: randomFn returns zero jitter (0.0)
        const zeroRandomFn = () => 0.0;
        const delayZeroJitter = computeBackoffMs(0, 3000, 500, 5000, 3050, zeroRandomFn);
        assert.equal(delayZeroJitter, 3000, 'Delay with zero jitter must equal server-specified delay 3000ms');

        // Exponential backoff with small budget and maximum jitter
        const expMaxJitter = computeBackoffMs(0, null, 500, 5000, 550, maxRandomFn);
        assert(expMaxJitter !== null);
        assert(expMaxJitter >= 500, 'Delay must be at least base exponential delay 500ms');
        assert(expMaxJitter <= 550, 'Delay with max jitter must not exceed 550ms budget');

        // Secondary check across 50 iterations with default randomFn
        for (let i = 0; i < 50; i++) {
            const delay = computeBackoffMs(0, 3000, 500, 5000, 3050);
            assert(delay !== null);
            assert(delay >= 3000, 'Delay must be at least 3000ms');
            assert(delay <= 3050, 'Delay with jitter must not exceed 3050ms remaining budget');
        }
    });

    test('11. The shared budget applies across primary and backup attempts', async () => {
        const calls = [];
        const clock = createMockClock();
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    if (req.model === PRIMARY_MODEL) {
                        clock.advance(3000); // Each primary call takes 3,000ms (3 * 3000 + retries sleep fits in 15s)
                        const err = new Error('503 Service Unavailable');
                        err.status = 503;
                        throw err;
                    }
                    // Backup succeeds within remaining budget
                    clock.advance(1000);
                    return { text: 'Backup response within shared budget' };
                }
            }
        };

        const result = await generateAIContent({
            contents: 'Test prompt',
            client: mockClient,
            budgetMs: 15000,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Backup response within shared budget');
        assert.deepEqual(calls, [PRIMARY_MODEL, PRIMARY_MODEL, PRIMARY_MODEL, BACKUP_MODEL]);
    });

    test('12. No additional request starts after the budget expires', async () => {
        const calls = [];
        const clock = createMockClock();
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    // Single call takes 16,000ms (exceeds the 15s budget) and returns success
                    clock.advance(16000);
                    return { text: 'Late response that arrived after deadline' };
                }
            }
        };

        // Even though model returned a valid response object, because it arrived after
        // the 15,000ms budget expired, the response MUST be discarded and throw 504 DEADLINE_EXCEEDED!
        await assert.rejects(
            async () => {
                await generateAIContent({
                    contents: 'Test prompt',
                    client: mockClient,
                    budgetMs: 15000,
                    nowFn: clock.nowFn,
                    sleepFn: clock.sleepFn
                });
            },
            (err) => {
                assert.equal(err.status, 504);
                assert.equal(err.category, 'DEADLINE_EXCEEDED');
                assert(err.message.includes('deadline exceeded'));
                return true;
            }
        );

        assert.equal(calls.length, 1, 'Only 1 request was made; no subsequent request started after budget expired');
    });

    test('13. API keys and tokens remain redacted in errors and logs', () => {
        const dirty = 'Error: API key AQ.Ab8RN6LI4qr9Jj28, pcsk_test1234567, and Bearer token1234567';
        const clean = sanitizeLogString(dirty);
        assert(!clean.includes('AQ.Ab8RN6LI4qr9Jj28'));
        assert(!clean.includes('pcsk_test1234567'));
        assert(clean.includes('[REDACTED_API_KEY]'));
        assert(clean.includes('[REDACTED_KEY]'));
        assert(clean.includes('Bearer [REDACTED_TOKEN]'));
    });

    test('14. Request configuration and systemInstruction are preserved', async () => {
        let capturedConfig = null;
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    capturedConfig = req.config;
                    return { text: 'Config test response' };
                }
            }
        };

        const clock = createMockClock();
        await generateAIContent({
            contents: 'Test prompt',
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 2048,
                topP: 0.8,
                topK: 40,
                responseMimeType: 'application/json'
            },
            config: {
                presencePenalty: 0.1
            },
            systemInstruction: 'You are Margdarshi, personal tutor',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(capturedConfig.temperature, 0.2);
        assert.equal(capturedConfig.maxOutputTokens, 2048);
        assert.equal(capturedConfig.topP, 0.8);
        assert.equal(capturedConfig.topK, 40);
        assert.equal(capturedConfig.responseMimeType, 'application/json');
        assert.equal(capturedConfig.presencePenalty, 0.1);
        assert.equal(capturedConfig.systemInstruction, 'You are Margdarshi, personal tutor');
    });

    test('15. Existing expected status codes and useful error messages remain consistent', async () => {
        assert.equal(indexName, 'margdarshi', 'Pinecone index name must remain margdarshi');
        assert.equal(PRIMARY_MODEL, 'gemini-3.7-flash', 'Primary model must remain gemini-3.7-flash');
        assert.equal(BACKUP_MODEL, 'gemini-3.5-flash', 'Backup model must remain approved gemini-3.5-flash');
        assert.equal(MAX_PRIMARY_RETRIES, 2);
        assert.equal(MAX_BACKUP_RETRIES, 1);
        assert.equal(MAX_RETRY_DELAY_BUDGET_MS, 15000);

        // Test BudgetTracker properties
        const tracker = new BudgetTracker(15000);
        assert.equal(tracker.totalBudgetMs, 15000);
        assert(tracker.remainingMs <= 15000);
        assert(tracker.remainingMs >= 0);
        assert.equal(tracker.isExpired, false);

        // Verify deadline error classification is NEVER reclassified as generic UNKNOWN
        const deadlineParsed = parseErrorDetails(new Error('AI request deadline exceeded'));
        assert.equal(deadlineParsed.isDeadlineError, true);
        const deadlineClass = classifyError(deadlineParsed);
        assert.equal(deadlineClass.category, 'DEADLINE_EXCEEDED');
        assert.equal(deadlineClass.isTransient, true);
        assert.notEqual(deadlineClass.category, 'UNKNOWN');

        // Verify generic unknown error classification
        const unknownClass = classifyError(parseErrorDetails(new Error('Some unexpected internal failure')));
        assert.equal(unknownClass.category, 'UNKNOWN');
        assert.equal(unknownClass.isPermanent, true);
        assert.equal(unknownClass.isFallbackEligible, false);
    });

    test('16. Google GenAI SDK JSON-encoded 429 ApiError with QuotaFailure is parsed as MODEL_SPECIFIC and falls back', async () => {
        const calls = [];
        const mockClient = {
            models: {
                generateContent: async (req) => {
                    calls.push(req.model);
                    if (req.model === PRIMARY_MODEL) {
                        // Reproduce exact Google GenAI SDK ApiError shape where error.message contains the JSON RPC payload
                        const rawApiError = new Error(JSON.stringify({
                            error: {
                                code: 429,
                                message: 'Resource has been exhausted (e.g. check quota).',
                                status: 'RESOURCE_EXHAUSTED',
                                details: [
                                    {
                                        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                                        violations: [
                                            {
                                                quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                                                quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                                                quotaDimensions: {
                                                    model: 'gemini-3.7-flash'
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        }));
                        rawApiError.status = 429;
                        throw rawApiError;
                    }
                    return { text: 'Successful fallback answer from gemini-3.5-flash' };
                }
            }
        };

        const clock = createMockClock();
        const result = await generateAIContent({
            contents: 'Test prompt for RAG question',
            client: mockClient,
            nowFn: clock.nowFn,
            sleepFn: clock.sleepFn
        });

        assert.equal(result.text, 'Successful fallback answer from gemini-3.5-flash');
        assert.equal(calls.length, 2, 'Primary model fails fast with model-specific quota; backup succeeds');
        assert.deepEqual(calls, [PRIMARY_MODEL, BACKUP_MODEL]);
    });

    test('17. Source citation deduplication correctly collapses identical document pages', () => {
        const sampleChunks = [
            { documentId: 'doc1', filename: 'se mod 1.pdf', pageNumber: 1, text: 'Software is a set of instructions...' },
            { documentId: 'doc1', filename: 'se mod 1.pdf', pageNumber: 1, text: 'Characteristics of software include...' },
            { documentId: 'doc1', filename: 'se mod 1.pdf', pageNumber: 2, text: 'Software engineering is the systematic approach...' },
            { documentId: 'doc2', filename: 'se mod 2.pdf', pageNumber: 1, text: 'Software process models...' },
            { documentId: 'doc1', filename: 'se mod 1.pdf', pageNumber: 1, text: 'Third chunk from page 1...' }
        ];

        let contextString = '';
        const sources = [];
        const seenSources = new Set();

        sampleChunks.forEach((chunk, i) => {
            contextString += `[Source ${i + 1}] Document: ${chunk.filename} (Page ${chunk.pageNumber})\n${chunk.text}\n\n`;
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

        // All 5 chunks must be in the prompt context so the AI model has full information
        assert.equal((contextString.match(/\[Source \d+\]/g) || []).length, 5);

        // Sources citations must be deduplicated by document and page number
        assert.equal(sources.length, 3, 'Should have exactly 3 unique document page citations');
        assert.deepEqual(
            sources.map(s => `${s.documentName}:Pg${s.page}`),
            ['se mod 1.pdf:Pg1', 'se mod 1.pdf:Pg2', 'se mod 2.pdf:Pg1']
        );
    });

    test('18. Document-grounded chat prompt includes selected chunks and question', () => {
        const question = 'what is software engineering and Nature of software';
        const contextString = '[Source 1] Document: se mod 1.pdf (Page 1)\nSoftware is logical rather than physical.\n\n';
        const prompt = RAG_PROMPT.replace('{context}', contextString || 'None').replace('{question}', question);

        assert(prompt.includes(question), 'Prompt must include the student question');
        assert(prompt.includes('se mod 1.pdf'), 'Prompt must include the document filename');
        assert(prompt.includes('Software is logical rather than physical'), 'Prompt must include retrieved chunk text');
        assert(prompt.includes("STUDENT'S NOTES:"), 'Prompt must retain template structure');
    });
});
