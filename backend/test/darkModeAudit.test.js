import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Margdarshi Complete Dark Mode Verification', () => {
    const frontendDir = path.resolve('..', 'frontend');
    const variablesCss = fs.readFileSync(path.join(frontendDir, 'css', 'variables.css'), 'utf8');

    const appPages = [
        'dashboard.html',
        'chat.html',
        'documents.html',
        'quizzes.html',
        'flashcards.html',
        'planner.html',
        'progress.html',
        'profile.html'
    ];

    test('1. variables.css defines complete design tokens for light and dark modes', () => {
        // Light mode tokens
        assert(variablesCss.includes('color-scheme: light;'), 'Must define color-scheme: light');
        assert(variablesCss.includes('--bg-page: #F8FAFC;'), 'Must define light bg-page');
        assert(variablesCss.includes('--bg-card: #FFFFFF;'), 'Must define light bg-card');
        assert(variablesCss.includes('--danger-light: #FEF2F2;'), 'Must define light danger background');
        assert(variablesCss.includes('--success-light: #ECFDF5;'), 'Must define light success background');

        // Dark mode tokens
        assert(variablesCss.includes('color-scheme: dark;'), 'Must define color-scheme: dark');
        assert(variablesCss.includes("html[data-theme='dark']"), 'Must define dark theme selector');
        assert(variablesCss.includes('--bg-page: #0B0F19;'), 'Must define deep dark navy bg-page');
        assert(variablesCss.includes('--bg-card: #151D2A;'), 'Must define charcoal dark surface bg-card');
        assert(variablesCss.includes('--danger-light: rgba(239, 68, 68, 0.15);'), 'Must define dark danger token');
        assert(variablesCss.includes('--success-light: rgba(16, 185, 129, 0.15);'), 'Must define dark success token');
    });

    test('2. Flashcard review buttons and surfaces have dedicated dark mode rules', () => {
        assert(variablesCss.includes(".btn-rate-learning"), 'Must style rate-learning button');
        assert(variablesCss.includes(".btn-rate-known"), 'Must style rate-known button');
        assert(variablesCss.includes(".btn-discard"), 'Must style discard button');
        assert(variablesCss.includes(".card-tile-preview"), 'Must style card-tile-preview');
        assert(variablesCss.includes(".deck-status-bar"), 'Must style deck-status-bar');
        assert(variablesCss.includes(".card-face-front"), 'Must style card-face-front');
        assert(variablesCss.includes(".study-progress-pill"), 'Must style study-progress-pill');

        const flashcardsHtml = fs.readFileSync(path.join(frontendDir, 'flashcards.html'), 'utf8');
        assert(!flashcardsHtml.includes('.card-tile-preview {\n            background: white;'),
            'flashcards.html must not hardcode background: white for card-tile-preview');
    });

    test('3. Quiz start button, active quiz stats, and results are styled in dark mode', () => {
        assert(variablesCss.includes(".btn-start-quiz"), 'Must style btn-start-quiz for dark mode');
        assert(variablesCss.includes(".stat-box-correct"), 'Must style quiz stat-box-correct');
        assert(variablesCss.includes(".stat-box-incorrect"), 'Must style quiz stat-box-incorrect');
        assert(variablesCss.includes(".result-award-pill"), 'Must style result-award-pill');

        const quizzesHtml = fs.readFileSync(path.join(frontendDir, 'quizzes.html'), 'utf8');
        assert(quizzesHtml.includes('class="stat-box-correct"'), 'quizzes.html must use stat-box-correct');
        assert(quizzesHtml.includes('class="stat-box-incorrect"'), 'quizzes.html must use stat-box-incorrect');
        assert(quizzesHtml.includes('class="result-award-pill"'), 'quizzes.html must use result-award-pill');
    });

    test('4. Study Planner form labels, callouts, and pills adapt to dark mode', () => {
        assert(variablesCss.includes(".planner-hero-header"), 'Must style planner-hero-header');
        assert(variablesCss.includes(".pro-tip-box"), 'Must style pro-tip-box');
        assert(variablesCss.includes(".pro-tip-text"), 'Must style pro-tip-text with high contrast');
        assert(variablesCss.includes(".subject-pill"), 'Must style subject-pill');
        assert(variablesCss.includes(".plan-progress-track"), 'Must style plan-progress-track');

        const plannerHtml = fs.readFileSync(path.join(frontendDir, 'planner.html'), 'utf8');
        assert(!plannerHtml.includes('color: #334155;'), 'planner.html must not hardcode dark text on form-label');
        assert(plannerHtml.includes('color: var(--text-primary);'), 'planner.html form-label must use var(--text-primary)');
    });

    test('5. Progress analytics charts and dynamic activity pills adapt to dark mode', () => {
        assert(variablesCss.includes(".chart-top-kpi-bar"), 'Must style chart-top-kpi-bar');
        assert(variablesCss.includes(".chart-dash"), 'Must style chart-dash');
        assert(variablesCss.includes(".chart-day-label"), 'Must style chart-day-label');
        assert(variablesCss.includes(".activity-card-item"), 'Must style activity-card-item');
        assert(variablesCss.includes(".activity-status-pill"), 'Must style activity-status-pill');

        const progressHtml = fs.readFileSync(path.join(frontendDir, 'progress.html'), 'utf8');
        assert(progressHtml.includes('border-bottom: 1px dashed var(--border-color);'),
            'progress.html chart-dash must use var(--border-color)');
        assert(progressHtml.includes('color: var(--text-secondary);'),
            'progress.html chart-day-label must use var(--text-secondary)');
        assert(progressHtml.includes('badge-chip blue'), 'progress.html must have blue chip class');
    });

    test('6. AI Tutor chat feedback buttons and suggestions adapt to dark mode', () => {
        assert(variablesCss.includes(".feedback-btn"), 'Must style feedback-btn for dark mode');
        assert(variablesCss.includes(".rag-source-pill"), 'Must style rag-source-pill for dark mode');
        assert(variablesCss.includes(".sugg-icon-box.blue"), 'Must style sugg-icon-box.blue');
        assert(variablesCss.includes(".sugg-icon-box.purple"), 'Must style sugg-icon-box.purple');
        assert(variablesCss.includes(".sugg-icon-box.green"), 'Must style sugg-icon-box.green');
        assert(variablesCss.includes(".sugg-icon-box.orange"), 'Must style sugg-icon-box.orange');

        const chatHtml = fs.readFileSync(path.join(frontendDir, 'chat.html'), 'utf8');
        assert(chatHtml.includes('class="rag-source-pill"'), 'chat.html must use rag-source-pill class');
        assert(chatHtml.includes('class="feedback-btn like"'), 'chat.html must use feedback-btn like class');
        assert(!chatHtml.includes("btn.style.background = '#ECFDF5'"),
            'chat.html must not hardcode inline background #ECFDF5 in toggleFeedback');
    });

    test('7. Dashboard plan badge and weak topic icon adapt to dark mode', () => {
        assert(variablesCss.includes(".dash-header-icon.red"), 'Must style dash-header-icon.red');
        assert(variablesCss.includes(".empty-icon-circle.purple"), 'Must style empty-icon-circle.purple');
        assert(variablesCss.includes(".empty-icon-circle.green"), 'Must style empty-icon-circle.green');
        assert(variablesCss.includes(".plan-status-badge"), 'Must style plan-status-badge');

        const dashHtml = fs.readFileSync(path.join(frontendDir, 'dashboard.html'), 'utf8');
        assert(dashHtml.includes('dash-header-icon red'), 'dashboard.html must use red class on weak topics');
        assert(dashHtml.includes('plan-status-badge'), 'dashboard.html must use plan-status-badge class');
    });

    test('8. Every app page links variables.css and theme.js with immediate theme script in <head>', () => {
        for (const page of appPages) {
            const content = fs.readFileSync(path.join(frontendDir, page), 'utf8');
            assert(content.includes('css/variables.css'), `${page} must link css/variables.css`);
            assert(content.includes('js/theme.js'), `${page} must include js/theme.js`);
            assert(content.includes("document.documentElement.setAttribute('data-theme', savedTheme)"),
                `${page} must have anti-FOUC theme script in head`);
        }
    });

    test('9. Catch-all rules protect dynamic elements with inline pastel backgrounds', () => {
        assert(variablesCss.includes('html[data-theme=\'dark\'] [style*="background: #EFF6FF"]'),
            'Must catch inline #EFF6FF');
        assert(variablesCss.includes('html[data-theme=\'dark\'] [style*="background: #ECFDF5"]'),
            'Must catch inline #ECFDF5');
        assert(variablesCss.includes('html[data-theme=\'dark\'] [style*="background: #FEF2F2"]'),
            'Must catch inline #FEF2F2');
        assert(variablesCss.includes('html[data-theme=\'dark\'] [style*="background: #F5F3FF"]'),
            'Must catch inline #F5F3FF');
        assert(variablesCss.includes('html[data-theme=\'dark\'] [style*="background: #FEF3C7"]'),
            'Must catch inline #FEF3C7');
    });
});
