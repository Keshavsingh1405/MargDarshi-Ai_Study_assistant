import { ai } from '../../config/gemini.js';

export const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
export const BACKUP_MODEL = process.env.GEMINI_BACKUP_MODEL || 'gemini-3.5-flash';

// Retry boundaries
export const MAX_PRIMARY_RETRIES = 2; // up to 3 attempts total (1 initial + 2 retries)
export const MAX_BACKUP_RETRIES = 1;  // up to 2 attempts total (1 initial + 1 retry)
export const DEFAULT_OPERATION_BUDGET_MS = Number(process.env.AI_OPERATION_BUDGET_MS) || 30000;
export const MAX_RETRY_DELAY_BUDGET_MS = 15000; // 15 seconds operation budget constant for test assertions

/**
 * Monotonic operation budget tracker.
 * Tracks elapsed time across both model API calls and retry waits using high-resolution monotonic time.
 */
export class BudgetTracker {
    constructor(totalBudgetMs = MAX_RETRY_DELAY_BUDGET_MS, nowFn = () => performance.now()) {
        this.totalBudgetMs = Math.max(0, totalBudgetMs);
        this.nowFn = nowFn;
        this.startTime = this.nowFn();
    }

    get elapsedMs() {
        return Math.max(0, this.nowFn() - this.startTime);
    }

    get remainingMs() {
        return Math.max(0, this.totalBudgetMs - this.elapsedMs);
    }

    get isExpired() {
        return this.remainingMs <= 0;
    }
}

/**
 * Sanitizes strings so secrets, keys, and tokens are never printed in logs.
 */
export const sanitizeLogString = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/AIza[0-9A-Za-z-_]{10,}/gi, '[REDACTED_API_KEY]')
        .replace(/AQ\.[0-9A-Za-z-_]{10,}/gi, '[REDACTED_API_KEY]')
        .replace(/pcsk_[0-9A-Za-z-_]{10,}/gi, '[REDACTED_KEY]')
        .replace(/re_[0-9A-Za-z-_]{10,}/gi, '[REDACTED_KEY]')
        .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]')
        .replace(/token=[a-zA-Z0-9._-]+/gi, 'token=[REDACTED_TOKEN]')
        .replace(/key=[a-zA-Z0-9._-]+/gi, 'key=[REDACTED_KEY]');
};

/**
 * Extracts and normalizes error metadata from Google GenAI SDK errors or network errors.
 * Inspects structured error metadata (error.error.details) before falling back to heuristics.
 */
export const parseErrorDetails = (error, nowMs = Date.now()) => {
    if (!error) {
        return {
            status: 500,
            statusText: 'UNKNOWN',
            isNetworkError: false,
            isDeadlineError: false,
            retryAfterMs: null,
            isConfirmedQuotaExhaustion: false,
            scope: 'UNKNOWN',
            sanitizedMessage: 'Unknown error'
        };
    }

    // Google GenAI SDK ApiError puts structured JSON in error.message (possibly with prefix)
    let parsedBody = null;
    if (typeof error.message === 'string') {
        const trimmed = error.message.trim();
        const jsonStart = trimmed.indexOf('{');
        const jsonEnd = trimmed.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
            try {
                parsedBody = JSON.parse(trimmed.substring(jsonStart, jsonEnd + 1));
            } catch {
                // Not valid JSON string
            }
        }
    }

    const errorObj = parsedBody?.error || error.error || error;

    // Google GenAI SDK ApiError structure
    const status = Number(
        error.status ||
        error.statusCode ||
        errorObj.code ||
        error.code
    ) || null;

    const statusText = String(
        errorObj.status ||
        error.statusText ||
        ''
    ).toUpperCase();

    // Check for network/connection issues
    const isNetworkError = Boolean(
        (error.name === 'TypeError' && (error.message?.includes('fetch failed') || error.message?.includes('network'))) ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        error.cause?.code === 'ECONNRESET'
    );

    let retryAfterMs = null;
    let isConfirmedQuotaExhaustion = false;
    let scope = 'UNKNOWN'; // 'PROJECT_WIDE' | 'MODEL_SPECIFIC' | 'UNKNOWN'

    // 1. Inspect structured error details from SDK (Google RPC error details)
    const details = Array.isArray(errorObj.details) ? errorObj.details :
        (Array.isArray(error.details) ? error.details : []);

    for (const detail of details) {
        // Inspect ErrorInfo
        if (detail['@type']?.includes('ErrorInfo') || detail.reason) {
            const reason = detail.reason || '';
            const metadata = detail.metadata || {};

            if (reason === 'QUOTA_EXHAUSTED') {
                isConfirmedQuotaExhaustion = true;
            }

            // Check metric scope
            const metric = metadata.quota_metric || '';
            if (metric.includes('PerDay') || metadata.quota_limit === '0') {
                isConfirmedQuotaExhaustion = true;
            }

            if (metadata.model || metric.includes('PerModel') || metric.includes('Model')) {
                scope = 'MODEL_SPECIFIC';
            } else if (metric.includes('PerProject') || metric.includes('Project')) {
                scope = 'PROJECT_WIDE';
            }
        }

        // Inspect QuotaFailure
        if (detail['@type']?.includes('QuotaFailure') && Array.isArray(detail.violations)) {
            isConfirmedQuotaExhaustion = true;
            for (const violation of detail.violations) {
                const qId = violation.quotaId || '';
                const qDims = violation.quotaDimensions || {};
                const qMetric = violation.quotaMetric || '';

                if (qDims.model || qId.includes('PerModel') || qMetric.includes('PerModel')) {
                    scope = 'MODEL_SPECIFIC';
                } else if (qId.includes('PerProject') || qMetric.includes('PerProject')) {
                    if (scope !== 'MODEL_SPECIFIC') {
                        scope = 'PROJECT_WIDE';
                    }
                }
            }
        }

        // Inspect RetryInfo
        if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
            if (typeof detail.retryDelay === 'string') {
                const sec = parseFloat(detail.retryDelay);
                if (!isNaN(sec) && sec > 0) {
                    retryAfterMs = Math.round(sec * 1000);
                }
            } else if (typeof detail.retryDelay === 'object') {
                const sec = Number(detail.retryDelay.seconds || 0);
                const nanos = Number(detail.retryDelay.nanos || 0);
                const total = sec * 1000 + Math.round(nanos / 1e6);
                if (total > 0) {
                    retryAfterMs = total;
                }
            }
        }
    }

    // 2. Inspect Retry-After HTTP headers (numeric seconds or HTTP-date)
    if (retryAfterMs === null) {
        const rawHeader = error.response?.headers?.get?.('retry-after') ||
            error.response?.headers?.['retry-after'];

        if (rawHeader) {
            const trimmed = String(rawHeader).trim();
            const numericSeconds = parseFloat(trimmed);
            if (!isNaN(numericSeconds) && /^\d+(\.\d+)?$/.test(trimmed)) {
                if (numericSeconds > 0) {
                    retryAfterMs = Math.round(numericSeconds * 1000);
                }
            } else {
                const parsedDate = Date.parse(trimmed);
                if (!isNaN(parsedDate)) {
                    const diff = parsedDate - nowMs;
                    if (diff > 0) {
                        retryAfterMs = diff;
                    }
                }
            }
        }
    }

    // 3. Fallback to error message hints if no structured metadata found
    const rawMessage = errorObj.message || error.message || 'Unknown error occurred';

    if (retryAfterMs === null && typeof rawMessage === 'string') {
        const match = rawMessage.match(/retry in ([0-9.]+)s/i) || rawMessage.match(/retry in ([0-9.]+)h([0-9.]+)m/i);
        if (match) {
            if (match[2]) {
                const hours = parseFloat(match[1]);
                const mins = parseFloat(match[2]);
                retryAfterMs = Math.round((hours * 3600 + mins * 60) * 1000);
            } else {
                const parsedSeconds = parseFloat(match[1]);
                if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
                    retryAfterMs = Math.round(parsedSeconds * 1000);
                }
            }
        }
    }

    // Check for deadline / timeout indicators
    const isDeadlineError = Boolean(
        status === 504 ||
        statusText === 'DEADLINE_EXCEEDED' ||
        error.code === 'DEADLINE_EXCEEDED' ||
        error.category === 'DEADLINE_EXCEEDED' ||
        error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        (typeof rawMessage === 'string' && /deadline exceeded/i.test(rawMessage))
    );

    // Heuristic scope and quota classification only when structured metadata was absent
    if (!isConfirmedQuotaExhaustion && (status === 429 || statusText === 'RESOURCE_EXHAUSTED')) {
        const fullMessageToInspect = `${typeof error.message === 'string' ? error.message : ''} ${typeof rawMessage === 'string' ? rawMessage : ''}`;
        if (/model:\s*[a-zA-Z0-9.-]+/i.test(fullMessageToInspect) || /quota exceeded for model/i.test(fullMessageToInspect) || /PerModel/i.test(fullMessageToInspect)) {
            isConfirmedQuotaExhaustion = true;
            scope = 'MODEL_SPECIFIC';
        } else if (/quota exceeded.*(per day|daily|project)/i.test(fullMessageToInspect) ||
            /daily quota exceeded/i.test(fullMessageToInspect) ||
            /quota limit.*0/i.test(fullMessageToInspect)) {
            isConfirmedQuotaExhaustion = true;
            scope = 'PROJECT_WIDE';
        }
    }

    // For 503 high-demand errors, the scope is model-specific capacity
    if (status === 503 || statusText === 'UNAVAILABLE') {
        if (scope === 'UNKNOWN') {
            scope = 'MODEL_SPECIFIC';
        }
    }

    const sanitizedMessage = sanitizeLogString(rawMessage).substring(0, 200);

    return {
        status: status || (isDeadlineError ? 504 : null),
        statusText: statusText || (isDeadlineError ? 'DEADLINE_EXCEEDED' : ''),
        isNetworkError,
        isDeadlineError,
        retryAfterMs,
        isConfirmedQuotaExhaustion,
        scope,
        sanitizedMessage
    };
};

/**
 * Classifies an error into permanent, transient, model-not-found, quota-exhausted, deadline, or unknown.
 */
export const classifyError = (errorDetails) => {
    const { status, statusText, isNetworkError, isDeadlineError, isConfirmedQuotaExhaustion, scope } = errorDetails;

    // Permanent client errors - invalid arguments, missing params, schema invalid
    if (status === 400 || statusText === 'INVALID_ARGUMENT') {
        return {
            isPermanent: true,
            isTransient: false,
            isModelNotFound: false,
            isFallbackEligible: false,
            category: 'INVALID_ARGUMENT',
            scope: 'REQUEST'
        };
    }

    // Permanent auth/permission errors - bad key, unauthorized, forbidden
    if (status === 401 || status === 403 || statusText === 'UNAUTHENTICATED' || statusText === 'PERMISSION_DENIED') {
        return {
            isPermanent: true,
            isTransient: false,
            isModelNotFound: false,
            isFallbackEligible: false,
            category: 'AUTH_ERROR',
            scope: 'PROJECT_WIDE'
        };
    }

    // Model not found or decommissioned
    if (status === 404 || statusText === 'NOT_FOUND') {
        return {
            isPermanent: false,
            isTransient: false,
            isModelNotFound: true,
            isFallbackEligible: true,
            category: 'MODEL_NOT_FOUND',
            scope: 'MODEL_SPECIFIC'
        };
    }

    // Confirmed quota exhaustion
    if (isConfirmedQuotaExhaustion) {
        if (scope === 'PROJECT_WIDE') {
            // Project quota exhausted: 0 retries, no fallback (backup would also fail)
            return {
                isPermanent: true,
                isTransient: false,
                isModelNotFound: false,
                isFallbackEligible: false,
                category: 'QUOTA_EXHAUSTED',
                scope: 'PROJECT_WIDE'
            };
        } else if (scope === 'MODEL_SPECIFIC') {
            // Model quota exhausted: 0 retries on this model, but backup model has independent quota
            return {
                isPermanent: true,
                isTransient: false,
                isModelNotFound: false,
                isFallbackEligible: true,
                category: 'QUOTA_EXHAUSTED',
                scope: 'MODEL_SPECIFIC'
            };
        } else {
            // Scope uncertain: conservative policy (do not assume backup has quota without evidence)
            return {
                isPermanent: true,
                isTransient: false,
                isModelNotFound: false,
                isFallbackEligible: false,
                category: 'QUOTA_EXHAUSTED',
                scope: 'UNKNOWN'
            };
        }
    }

    // Transient recoverable rate limiting (e.g. RPM/TPM spike)
    if (status === 429 || statusText === 'RESOURCE_EXHAUSTED') {
        return {
            isPermanent: false,
            isTransient: true,
            isModelNotFound: false,
            isFallbackEligible: scope !== 'PROJECT_WIDE',
            category: 'RATE_LIMIT',
            scope
        };
    }

    // Deadline and timeout errors: transient, fallback-eligible if budget permits (never classified as generic UNKNOWN)
    if (isDeadlineError || status === 504 || statusText === 'DEADLINE_EXCEEDED' || errorDetails.category === 'DEADLINE_EXCEEDED') {
        return {
            isPermanent: false,
            isTransient: true,
            isModelNotFound: false,
            isFallbackEligible: true,
            category: 'DEADLINE_EXCEEDED',
            scope: scope === 'UNKNOWN' ? 'OPERATION' : scope
        };
    }

    // Known transient server errors & network timeouts
    if (status === 500 || status === 502 || status === 503 || statusText === 'UNAVAILABLE' || isNetworkError) {
        return {
            isPermanent: false,
            isTransient: true,
            isModelNotFound: false,
            isFallbackEligible: true,
            category: 'SERVER_TRANSIENT',
            scope: scope || 'MODEL_SPECIFIC'
        };
    }

    // Default: unknown errors are NON-RETRYABLE and INELIGIBLE for fallback
    return {
        isPermanent: true,
        isTransient: false,
        isModelNotFound: false,
        isFallbackEligible: false,
        category: 'UNKNOWN',
        scope: 'UNKNOWN'
    };
};

/**
 * Computes backoff delay with jitter respecting server delay and remaining budget.
 * Returns null if the delay cannot fit within the remaining request budget.
 * Guarantees that jitter never pushes the delay beyond maxBudgetMs.
 */
export const computeBackoffMs = (attempt, retryAfterMs = null, baseMs = 500, maxMs = 5000, maxBudgetMs = MAX_RETRY_DELAY_BUDGET_MS, randomFn = Math.random) => {
    if (maxBudgetMs <= 0) {
        return null;
    }

    if (retryAfterMs !== null && retryAfterMs !== undefined) {
        // If server-specified delay exceeds the budget, cannot fit
        if (retryAfterMs > maxBudgetMs) {
            return null;
        }
        // Jitter must never push delay beyond maxBudgetMs
        const maxJitter = Math.max(0, Math.min(200, maxBudgetMs - retryAfterMs));
        const jitter = maxJitter > 0 ? Math.floor(randomFn() * maxJitter) : 0;
        return retryAfterMs + jitter;
    }

    const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    if (exponential > maxBudgetMs) {
        return null;
    }
    const maxJitter = Math.max(0, Math.min(200, maxBudgetMs - exponential));
    const jitter = maxJitter > 0 ? Math.floor(randomFn() * maxJitter) : 0;
    return exponential + jitter;
};

/**
 * Safely merges generationConfig and config while preserving all supported properties.
 */
export const mergeGenerationConfig = (config, generationConfig) => {
    const merged = {};

    if (generationConfig && typeof generationConfig === 'object') {
        const supportedKeys = [
            'temperature',
            'maxOutputTokens',
            'topP',
            'topK',
            'candidateCount',
            'responseMimeType',
            'responseSchema',
            'stopSequences',
            'presencePenalty',
            'frequencyPenalty',
            'seed',
            'systemInstruction'
        ];
        for (const key of supportedKeys) {
            if (generationConfig[key] !== undefined) {
                merged[key] = generationConfig[key];
            }
        }
    }

    if (config && typeof config === 'object') {
        for (const [key, value] of Object.entries(config)) {
            if (value !== undefined) {
                merged[key] = value;
            }
        }
    }

    return merged;
};

/**
 * Executes content generation on a single model with bounded retries and continuous budget tracking.
 */
const executeModelWithRetries = async ({
    clientInstance,
    model,
    requestObj,
    maxRetries,
    isBackup = false,
    budgetTracker,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) => {
    let lastError = null;
    let lastErrorDetails = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // 1. Check budget before starting request
        if (budgetTracker.isExpired) {
            console.warn(`[AI Service] Total request budget expired (${budgetTracker.elapsedMs.toFixed(1)}ms elapsed). Skipping attempt for '${model}'.`);
            return {
                success: false,
                error: lastError || new Error(`Request deadline exceeded for model '${model}'.`),
                errorDetails: lastErrorDetails,
                classification: lastErrorDetails ? classifyError(lastErrorDetails) : { category: 'DEADLINE_EXCEEDED' },
                fatal: false,
                budgetExceeded: true
            };
        }

        const attemptLabel = `attempt ${attempt + 1}/${maxRetries + 1}`;
        try {
            console.log(`[AI Service] Attempting model: ${model} (${isBackup ? 'BACKUP' : 'PRIMARY'}, ${attemptLabel}, Budget remaining: ${budgetTracker.remainingMs.toFixed(0)}ms)`);

            const modelConfig = { ...(requestObj.config || {}) };
            if (!modelConfig.httpOptions?.retryOptions) {
                modelConfig.httpOptions = {
                    ...modelConfig.httpOptions,
                    retryOptions: { attempts: 1 }
                };
            }

            const response = await clientInstance.models.generateContent({
                ...requestObj,
                config: modelConfig,
                model
            });

            // 2. Check budget after request completes:
            // If the operation deadline expired while the call was in flight, do not treat as successful.
            if (budgetTracker.isExpired) {
                console.warn(`[AI Service] Model '${model}' completed after operation deadline expired (${budgetTracker.elapsedMs.toFixed(1)}ms elapsed). Response discarded.`);
                const timeoutErr = new Error(`AI request deadline exceeded: operation finished after ${budgetTracker.totalBudgetMs}ms budget.`);
                timeoutErr.status = 504;
                timeoutErr.category = 'DEADLINE_EXCEEDED';
                throw timeoutErr;
            }

            if (response && response.text) {
                console.log(`[AI Service] Model '${model}' succeeded on ${attemptLabel}.`);
                return { success: true, response };
            }
            throw new Error(`Model '${model}' returned an empty or invalid response.`);
        } catch (error) {
            lastError = error;
            lastErrorDetails = parseErrorDetails(error);
            const classification = classifyError(lastErrorDetails);

            console.warn(
                `[AI Service] Model '${model}' failed on ${attemptLabel} ` +
                `(HTTP ${lastErrorDetails.status || 'N/A'}, Code: ${classification.category}, Scope: ${classification.scope}): ${lastErrorDetails.sanitizedMessage}`
            );

            // If operation budget is expired
            if (budgetTracker.isExpired || error.category === 'DEADLINE_EXCEEDED') {
                return {
                    success: false,
                    error: lastError,
                    errorDetails: lastErrorDetails,
                    classification: {
                        ...classification,
                        category: 'DEADLINE_EXCEEDED'
                    },
                    fatal: false,
                    budgetExceeded: true
                };
            }

            // Permanent errors, quota exhaustion without fallback, or unknown errors: stop immediately
            if (classification.isPermanent) {
                return {
                    success: false,
                    error: lastError,
                    errorDetails: lastErrorDetails,
                    classification,
                    fatal: !classification.isFallbackEligible,
                    budgetExceeded: false
                };
            }

            // Model not found: non-retryable on this model, but eligible for fallback
            if (classification.isModelNotFound) {
                return {
                    success: false,
                    error: lastError,
                    errorDetails: lastErrorDetails,
                    classification,
                    fatal: false,
                    budgetExceeded: false
                };
            }

            // If transient and retries remain, check budget for retry backoff
            if (attempt < maxRetries && classification.isTransient) {
                const backoffMs = computeBackoffMs(attempt, lastErrorDetails.retryAfterMs, 500, 5000, budgetTracker.remainingMs);
                if (backoffMs === null) {
                    console.warn(
                        `[AI Service] Retry delay for '${model}' (${lastErrorDetails.retryAfterMs || 'backoff'}ms) cannot fit within remaining budget (${budgetTracker.remainingMs.toFixed(0)}ms). Aborting retries on this model.`
                    );
                    return {
                        success: false,
                        error: lastError,
                        errorDetails: lastErrorDetails,
                        classification,
                        fatal: false,
                        budgetExceeded: true
                    };
                }

                console.log(`[AI Service] Retrying '${model}' in ${backoffMs}ms... (Remaining budget: ${(budgetTracker.remainingMs - backoffMs).toFixed(0)}ms)`);
                await sleepFn(backoffMs);
            }
        }
    }

    return {
        success: false,
        error: lastError,
        errorDetails: lastErrorDetails,
        classification: classifyError(lastErrorDetails),
        fatal: false,
        budgetExceeded: budgetTracker.isExpired
    };
};

/**
 * Main generateAIContent interface.
 * Implements primary model -> bounded retries -> single approved backup model -> failure.
 * Tracks cumulative elapsed time across API calls and retry waits using monotonic clock.
 */
export const generateAIContent = async ({
    contents,
    config,
    generationConfig,
    systemInstruction,
    preferredModel = PRIMARY_MODEL,
    backupModel = BACKUP_MODEL,
    client = ai,
    budgetTracker = null,
    budgetMs = DEFAULT_OPERATION_BUDGET_MS,
    nowFn = () => performance.now(),
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) => {
    const mergedConfig = mergeGenerationConfig(config, generationConfig);

    // Ensure systemInstruction is included if passed top-level and not in config
    if (systemInstruction !== undefined && mergedConfig.systemInstruction === undefined) {
        mergedConfig.systemInstruction = systemInstruction;
    }

    const baseRequest = {
        contents
    };
    if (Object.keys(mergedConfig).length > 0) {
        baseRequest.config = mergedConfig;
    }

    const primaryTarget = preferredModel || PRIMARY_MODEL;
    const backupTarget = backupModel || BACKUP_MODEL;

    // Single shared budget tracker across primary and backup attempts
    const activeBudget = budgetTracker || new BudgetTracker(budgetMs, nowFn);

    // 1. Try Primary Model
    const primaryResult = await executeModelWithRetries({
        clientInstance: client,
        model: primaryTarget,
        requestObj: baseRequest,
        maxRetries: MAX_PRIMARY_RETRIES,
        isBackup: false,
        budgetTracker: activeBudget,
        sleepFn
    });

    if (primaryResult.success) {
        return primaryResult.response;
    }

    // If budget was exceeded on a project-wide, rate-limiting, or general deadline expiration,
    // do NOT call the backup model if budget is exhausted or server delay cooldown must be honored
    if (primaryResult.budgetExceeded || activeBudget.isExpired) {
        const isProjectOrRateLimit = primaryResult.classification?.category === 'RATE_LIMIT' ||
            primaryResult.classification?.scope === 'PROJECT_WIDE' ||
            primaryResult.classification?.scope === 'UNKNOWN';

        if (isProjectOrRateLimit && primaryResult.errorDetails?.retryAfterMs) {
            console.warn(
                `[AI Service] Server specified retry delay exceeded budget on ${primaryResult.classification.category} (${primaryResult.classification.scope}). Fallback suppressed to honor server retry delay.`
            );
            const err = new Error('AI service rate limit delay exceeded allowed request budget. Please try again later.');
            err.status = primaryResult.errorDetails?.status || 429;
            err.category = primaryResult.classification?.category;
            err.scope = primaryResult.classification?.scope;
            throw err;
        }

        if (activeBudget.isExpired) {
            console.warn(`[AI Service] Operation budget exhausted (${activeBudget.elapsedMs.toFixed(1)}ms elapsed). Fallback aborted.`);
            const err = new Error(primaryResult.error?.message || 'AI request deadline exceeded: operation time budget exhausted before fallback could complete.');
            err.status = 504;
            err.category = 'DEADLINE_EXCEEDED';
            throw err;
        }
    }

    // Check if primary failure is eligible for fallback
    // Permanent errors (400, 401, 403), project quota exhaustion, and unknown errors MUST NOT fall back
    if (primaryResult.fatal || !primaryResult.classification?.isFallbackEligible) {
        const errorMsg = primaryResult.errorDetails?.sanitizedMessage || 'AI request failed.';
        const err = new Error(`AI request rejected (${primaryResult.classification?.category}): ${errorMsg}`);
        err.status = primaryResult.errorDetails?.status || 400;
        err.category = primaryResult.classification?.category;
        err.scope = primaryResult.classification?.scope;
        throw err;
    }

    // If no distinct backup model, stop
    if (!backupTarget || backupTarget === primaryTarget) {
        const err = new Error(`Primary model '${primaryTarget}' failed and no distinct backup model is available.`);
        err.status = primaryResult.errorDetails?.status || 500;
        throw err;
    }

    if (activeBudget.isExpired) {
        const err = new Error('AI request deadline exceeded: operation time budget exhausted before fallback could be attempted.');
        err.status = 504;
        err.category = 'DEADLINE_EXCEEDED';
        throw err;
    }

    // 2. Controlled Fallback to the single approved backup model
    console.warn(
        `[AI Service] Primary model '${primaryTarget}' exhausted attempts (${primaryResult.classification?.category}, ${primaryResult.classification?.scope}). ` +
        `Initiating fallback to approved backup model '${backupTarget}' (Budget remaining: ${activeBudget.remainingMs.toFixed(0)}ms)...`
    );

    const backupResult = await executeModelWithRetries({
        clientInstance: client,
        model: backupTarget,
        requestObj: baseRequest,
        maxRetries: MAX_BACKUP_RETRIES,
        isBackup: true,
        budgetTracker: activeBudget,
        sleepFn
    });

    if (backupResult.success) {
        return backupResult.response;
    }

    // 3. Dynamic Model-Specific Quota / Availability Rescue Fallback:
    // When BOTH primary and backup models have exhausted their model-specific quota or failed due to model availability,
    // and sufficient budget remains (> 2500ms), attempt approved alternate active models before throwing.
    const isModelSpecificExhaustion =
        (primaryResult.classification?.category === 'QUOTA_EXHAUSTED' || primaryResult.classification?.category === 'MODEL_NOT_FOUND') &&
        (backupResult.classification?.category === 'QUOTA_EXHAUSTED' || backupResult.classification?.category === 'MODEL_NOT_FOUND');

    if (isModelSpecificExhaustion && !activeBudget.isExpired && activeBudget.remainingMs > 2500) {
        const approvedFallbacks = (process.env.GEMINI_FALLBACK_MODELS
            ? process.env.GEMINI_FALLBACK_MODELS.split(',').map(s => s.trim())
            : ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
        ).filter(m => m && m !== primaryTarget && m !== backupTarget);

        for (const candidate of approvedFallbacks) {
            if (activeBudget.isExpired || activeBudget.remainingMs < 2500) break;

            console.warn(
                `[AI Service] Both primary ('${primaryTarget}') and backup ('${backupTarget}') failed with model-specific quota exhaustion. ` +
                `Attempting approved rescue candidate '${candidate}' (Budget remaining: ${activeBudget.remainingMs.toFixed(0)}ms)...`
            );

            const candidateResult = await executeModelWithRetries({
                clientInstance: client,
                model: candidate,
                requestObj: baseRequest,
                maxRetries: 1,
                isBackup: true,
                budgetTracker: activeBudget,
                sleepFn
            });

            if (candidateResult.success) {
                console.log(`[AI Service] Rescue fallback model '${candidate}' succeeded.`);
                return candidateResult.response;
            }
        }
    }

    // Both models (and any rescue candidates) failed
    const primaryReason = primaryResult.errorDetails?.sanitizedMessage || primaryResult.classification?.category;
    const backupReason = backupResult.errorDetails?.sanitizedMessage || backupResult.classification?.category;
    console.error(
        `[AI Service] All AI models failed. Primary ('${primaryTarget}'): ${primaryReason}. Backup ('${backupTarget}'): ${backupReason}.`
    );

    const isQuotaExhausted = primaryResult.classification?.category === 'QUOTA_EXHAUSTED' && backupResult.classification?.category === 'QUOTA_EXHAUSTED';
    const isRateLimited = primaryResult.classification?.category === 'RATE_LIMIT' || backupResult.classification?.category === 'RATE_LIMIT';
    const isDeadline = activeBudget.isExpired || backupResult.budgetExceeded;

    let userFacingMessage = 'AI service is temporarily unavailable. Both primary and backup models failed to respond.';
    let finalStatus = isDeadline ? 504 : 503;
    let finalCategory = isDeadline ? 'DEADLINE_EXCEEDED' : 'SERVER_UNAVAILABLE';

    if (isQuotaExhausted) {
        finalStatus = 429;
        finalCategory = 'QUOTA_EXHAUSTED';
        userFacingMessage = `AI service quota exceeded: Daily free-tier request limit reached for configured models (${primaryTarget}, ${backupTarget}). Please check your Gemini API plan or update your configured model.`;
    } else if (isRateLimited) {
        finalStatus = 429;
        finalCategory = 'RATE_LIMIT';
        userFacingMessage = 'AI service rate limit reached. Please wait a moment and try again.';
    } else if (isDeadline) {
        userFacingMessage = `AI service request deadline exceeded (${activeBudget.totalBudgetMs}ms budget). Please try again.`;
    }

    const finalError = new Error(userFacingMessage);
    finalError.status = finalStatus;
    finalError.category = finalCategory;
    finalError.primaryModel = primaryTarget;
    finalError.backupModel = backupTarget;
    finalError.primaryError = primaryReason;
    finalError.backupError = backupReason;
    throw finalError;
};
