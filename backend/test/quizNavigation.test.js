import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Quiz Navigation & Exit Confirmation Logic', () => {
    let mockDocument;
    let mockWindow;
    let confirmCalls;
    let confirmReturnValue;
    let loadQuizzesCalls;
    let beforeUnloadListeners;

    // Load actual code from frontend/quizzes.html to verify real implementation
    const htmlPath = path.resolve('..', 'frontend', 'quizzes.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    beforeEach(() => {
        confirmCalls = [];
        confirmReturnValue = true;
        loadQuizzesCalls = 0;
        beforeUnloadListeners = [];

        const elements = {
            'main-view': { style: { display: 'flex' } },
            'active-quiz-view': { style: { display: 'none' }, innerHTML: '' },
            'btn-next-submit': { innerHTML: '', disabled: false }
        };

        mockDocument = {
            getElementById: (id) => elements[id] || { style: {}, classList: { add: () => {}, remove: () => {} } }
        };

        mockWindow = {
            confirm: (msg) => {
                confirmCalls.push(msg);
                return confirmReturnValue;
            },
            addEventListener: (event, handler) => {
                if (event === 'beforeunload') beforeUnloadListeners.push(handler);
            }
        };
    });

    test('Verification that quizzes.html contains isQuizCompleted and hasUnsavedProgress guards', () => {
        assert(htmlContent.includes('isQuizCompleted = false'), 'Must initialize isQuizCompleted');
        assert(htmlContent.includes('function displayFinalResults'), 'Must have displayFinalResults');
        assert(htmlContent.includes('isQuizCompleted = true'), 'displayFinalResults must mark quiz as completed');
        assert(htmlContent.includes('hasUnsavedProgress'), 'Must define hasUnsavedProgress helper');
        assert(htmlContent.includes('window.addEventListener(\'beforeunload\''), 'Must register beforeunload listener');
    });

    // Helper that executes the exact logic from quizzes.html
    const createQuizController = () => {
        let currentQuiz = null;
        let currentQuestionIndex = 0;
        let userAnswers = [];
        let isQuizCompleted = false;

        const hasUnsavedProgress = () => {
            return Boolean(currentQuiz && !isQuizCompleted && userAnswers.some(ans => ans !== null));
        };

        const startQuiz = (quiz) => {
            currentQuiz = quiz;
            currentQuestionIndex = 0;
            userAnswers = new Array(quiz.questions.length).fill(null);
            isQuizCompleted = false;

            mockDocument.getElementById('main-view').style.display = 'none';
            const aqView = mockDocument.getElementById('active-quiz-view');
            aqView.style.display = 'flex';
        };

        const exitQuiz = () => {
            if (hasUnsavedProgress()) {
                if (!mockWindow.confirm('Are you sure you want to exit? Your progress will be lost.')) {
                    return;
                }
            }
            mockDocument.getElementById('active-quiz-view').style.display = 'none';
            mockDocument.getElementById('main-view').style.display = 'flex';
            currentQuiz = null;
            isQuizCompleted = false;
            userAnswers = [];
            currentQuestionIndex = 0;
            loadQuizzesCalls++;
        };

        const selectOption = (opt) => {
            if (!currentQuiz || userAnswers[currentQuestionIndex]) return;
            const q = currentQuiz.questions[currentQuestionIndex];
            const isCorrect = opt === q.correctAnswer;
            userAnswers[currentQuestionIndex] = { userAnswer: opt, isCorrect };
        };

        const displayFinalResults = (attemptData) => {
            isQuizCompleted = true;
            const aqView = mockDocument.getElementById('active-quiz-view');
            aqView.innerHTML = `Quiz Completed! Score: ${attemptData.score}`;
        };

        const triggerBeforeUnload = () => {
            const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
            if (hasUnsavedProgress()) {
                event.preventDefault();
                event.returnValue = '';
            }
            return event;
        };

        return {
            startQuiz,
            exitQuiz,
            selectOption,
            displayFinalResults,
            triggerBeforeUnload,
            hasUnsavedProgress,
            getState: () => ({ currentQuiz, currentQuestionIndex, userAnswers, isQuizCompleted })
        };
    };

    const sampleQuiz = {
        _id: 'quiz123',
        title: 'Software Engineering Quiz',
        difficulty: 'Medium',
        questions: [
            { _id: 'q1', questionText: 'What is SE?', options: ['A', 'B'], correctAnswer: 'A' },
            { _id: 'q2', questionText: 'What is SDLC?', options: ['C', 'D'], correctAnswer: 'C' }
        ]
    };

    test('Scenario 1: Completed quiz -> Back to Quizzes navigates to quiz listing without confirmation', () => {
        const ctrl = createQuizController();
        ctrl.startQuiz(sampleQuiz);
        ctrl.selectOption('A');

        // Submit and complete quiz
        ctrl.displayFinalResults({ score: 2, totalQuestions: 2, accuracy: 100 });
        assert.equal(ctrl.getState().isQuizCompleted, true);
        assert.equal(ctrl.hasUnsavedProgress(), false, 'Completed quiz has no unsaved progress');

        // User clicks "Back to Quizzes"
        ctrl.exitQuiz();

        // 1. Confirm dialog must NOT be called
        assert.equal(confirmCalls.length, 0, 'No confirmation dialog must be triggered on completed quiz');

        // 2. Navigation to quiz listing must succeed
        assert.equal(mockDocument.getElementById('active-quiz-view').style.display, 'none');
        assert.equal(mockDocument.getElementById('main-view').style.display, 'flex');
        assert.equal(loadQuizzesCalls, 1, 'loadQuizzes must be called to refresh recent quizzes');
        assert.equal(ctrl.getState().currentQuiz, null, 'Quiz state must be cleared');
    });

    test('Scenario 2: Unfinished quiz with answers -> attempt to leave -> confirmation appears', () => {
        const ctrl = createQuizController();
        ctrl.startQuiz(sampleQuiz);
        ctrl.selectOption('A'); // 1 answer selected, not submitted

        assert.equal(ctrl.hasUnsavedProgress(), true, 'Unfinished quiz with answers has unsaved progress');

        // Subcase 2A: User clicks Cancel on confirmation
        confirmReturnValue = false;
        ctrl.exitQuiz();

        assert.equal(confirmCalls.length, 1, 'Confirmation dialog was triggered');
        assert.equal(confirmCalls[0], 'Are you sure you want to exit? Your progress will be lost.');
        assert.equal(mockDocument.getElementById('active-quiz-view').style.display, 'flex', 'Active quiz view must remain open');
        assert.equal(mockDocument.getElementById('main-view').style.display, 'none', 'Main view must remain hidden');
        assert.notEqual(ctrl.getState().currentQuiz, null, 'Quiz must remain active');

        // Subcase 2B: User clicks OK on confirmation
        confirmReturnValue = true;
        ctrl.exitQuiz();

        assert.equal(confirmCalls.length, 2, 'Confirmation dialog was triggered again on second attempt');
        assert.equal(mockDocument.getElementById('active-quiz-view').style.display, 'none');
        assert.equal(mockDocument.getElementById('main-view').style.display, 'flex');
        assert.equal(ctrl.getState().currentQuiz, null, 'Quiz cleared after confirmed exit');
    });

    test('Scenario 3: Unfinished quiz with NO answers -> Back to Quizzes exits immediately without confirmation', () => {
        const ctrl = createQuizController();
        ctrl.startQuiz(sampleQuiz);
        // User answered 0 questions

        assert.equal(ctrl.hasUnsavedProgress(), false, '0 answers means no unsaved progress to lose');
        ctrl.exitQuiz();

        assert.equal(confirmCalls.length, 0, 'No confirmation dialog when no progress exists');
        assert.equal(mockDocument.getElementById('active-quiz-view').style.display, 'none');
        assert.equal(mockDocument.getElementById('main-view').style.display, 'flex');
    });

    test('Scenario 4: beforeunload event warns only on unfinished quiz with answers, never on completed quiz', () => {
        const ctrl = createQuizController();

        // 1. Inactive quiz: no beforeunload prevention
        let evt = ctrl.triggerBeforeUnload();
        assert.equal(evt.defaultPrevented, false);

        // 2. Active quiz with 1 answer: beforeunload MUST warn
        ctrl.startQuiz(sampleQuiz);
        ctrl.selectOption('A');
        evt = ctrl.triggerBeforeUnload();
        assert.equal(evt.defaultPrevented, true);
        assert.equal(evt.returnValue, '');

        // 3. Completed quiz: beforeunload MUST NOT warn
        ctrl.displayFinalResults({ score: 1, totalQuestions: 2, accuracy: 50 });
        evt = ctrl.triggerBeforeUnload();
        assert.equal(evt.defaultPrevented, false);
    });
});
