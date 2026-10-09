import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Flashcards Frontend Structure & Question-First Visibility Tests', () => {
    const htmlPath = path.resolve('..', 'frontend', 'flashcards.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    test('1. flashcards.html contains optional Deck Title field for meaningful or custom titles', () => {
        assert(htmlContent.includes('id="deck-title"'), 'Must contain deck-title input field');
        assert(htmlContent.includes('Deck Title'), 'Must have Deck Title label');
    });

    test('2. flashcards.html contains duplicate generation submission protection', () => {
        assert(htmlContent.includes('let isGenerating = false'), 'Must define isGenerating flag');
        assert(htmlContent.includes('if (isGenerating) return;'), 'Must prevent execution when already generating');
        assert(htmlContent.includes('btn.disabled = true;'), 'Must disable generate button during request');
        assert(htmlContent.includes('isGenerating = false;'), 'Must reset isGenerating flag in finally block');
    });

    test('3. flashcards.html contains independent decks grid and deck deletion per deck', () => {
        assert(htmlContent.includes('id="decks-grid"'), 'Must contain decks-grid container');
        assert(htmlContent.includes('deleteSpecificDeck'), 'Must define deleteSpecificDeck function');
        assert(htmlContent.includes('DELETE'), 'Must call DELETE method for deck deletion');
        assert(htmlContent.includes('/flashcards/decks/'), 'Must target specific deck endpoint on deletion');
    });

    test('4. Question-first visibility: Front face is Question and Answer is hidden on Back face', () => {
        assert(htmlContent.includes('class="card-face card-face-front"'), 'Must contain front card face');
        assert(htmlContent.includes('class="card-face card-face-back"'), 'Must contain back card face');
        assert(htmlContent.includes('tag-question'), 'Must style front face as Question tag');
        assert(htmlContent.includes('tag-answer'), 'Must style back face as Answer tag');
        assert(htmlContent.includes('id="card-front"'), 'Must place question in card-front');
        assert(htmlContent.includes('id="card-back"'), 'Must place answer in card-back');
    });

    test('5. flashcards.html contains controls for Previous Card, Next Card, and Flip Card', () => {
        assert(htmlContent.includes('id="btn-prev-card"'), 'Must contain Previous Card button');
        assert(htmlContent.includes('id="btn-next-card"'), 'Must contain Next Card button');
        assert(htmlContent.includes('id="btn-flip-card"'), 'Must contain Flip Card button');
        assert(htmlContent.includes('btn-flip-label'), 'Must contain dynamic flip button label');
    });

    test('6. Reset behavior: moving to another card resets card to Question side', () => {
        assert(htmlContent.includes('scene.classList.remove(\'is-flipped\')'), 'showCard must reset is-flipped');
        assert(htmlContent.includes('Reveal Answer'), 'showCard must reset flip label to Reveal Answer');
    });

    test('7. Preview cards do not spoil answers immediately', () => {
        assert(htmlContent.includes('preview-a-toggle'), 'Must provide toggle button to reveal answer in preview');
        assert(htmlContent.includes('Show Answer'), 'Must label preview button as Show Answer');
        assert(htmlContent.includes('display: none'), 'Must keep preview answer hidden by default');
    });
});
