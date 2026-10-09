import 'dotenv/config';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Flashcard from '../src/models/Flashcard.js';
import FlashcardDeck from '../src/models/FlashcardDeck.js';
import {
    generateFlashcards,
    getDecks,
    getDeckById,
    deleteDeck,
    reviewFlashcard,
    generateDefaultDeckTitle,
    ensureLegacyDecks
} from '../src/controllers/flashcardController.js';

describe('Flashcard Deck Creation, Isolation, and Lifecycle Tests', () => {
    const testUserId1 = new mongoose.Types.ObjectId();
    const testUserId2 = new mongoose.Types.ObjectId();

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/margdarshi');
        }
    });

    after(async () => {
        await FlashcardDeck.deleteMany({ userId: { $in: [testUserId1, testUserId2] } });
        await Flashcard.deleteMany({ userId: { $in: [testUserId1, testUserId2] } });
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        await FlashcardDeck.deleteMany({ userId: { $in: [testUserId1, testUserId2] } });
        await Flashcard.deleteMany({ userId: { $in: [testUserId1, testUserId2] } });
    });

    test('1. generateDefaultDeckTitle produces meaningful title format', () => {
        const title1 = generateDefaultDeckTitle('Software Engineering', 'Nature of software', new Date('2026-10-09T20:15:00Z'));
        assert(title1.startsWith('Software Engineering: Nature of software — '), 'Title must contain subject and topic');
        
        const title2 = generateDefaultDeckTitle('Biology', '', new Date('2026-10-09T14:30:00Z'));
        assert(title2.startsWith('Biology — '), 'Title without topic should be Subject — Date');
    });

    test('2. First generation creates a new deck with unique deck ID and associated cards', async () => {
        const mockAI = async () => ({
            text: JSON.stringify({
                flashcards: [
                    { front: 'What is Polymorphism?', back: 'Ability of different types to respond to the same message.' },
                    { front: 'What is Encapsulation?', back: 'Bundling data and methods operating on that data.' }
                ]
            })
        });
        const mockRetriever = async () => [{ text: 'OOP concepts note' }];

        const req = {
            user: { _id: testUserId1 },
            body: {
                subject: 'Computer Science',
                topic: 'OOP Principles',
                count: 2
            }
        };

        let responseStatus = 200;
        let responseJson = null;
        const res = {
            status(s) { responseStatus = s; return this; },
            json(data) { responseJson = data; return this; }
        };

        await generateFlashcards(req, res, () => {}, {
            generateAIContent: mockAI,
            retrieveRelevantChunks: mockRetriever
        });

        assert.equal(responseStatus, 201, 'Must return 201 Created');
        assert(responseJson.success, 'Must succeed');
        assert(responseJson.data._id, 'Deck must have a unique _id');
        assert.equal(responseJson.data.subject, 'Computer Science');
        assert.equal(responseJson.data.topic, 'OOP Principles');
        assert.equal(responseJson.data.cardCount, 2);
        assert.equal(responseJson.data.cards.length, 2);

        // Verify database persistence
        const savedDeck = await FlashcardDeck.findById(responseJson.data._id);
        assert(savedDeck, 'Deck must be persisted in FlashcardDeck collection');
        assert.equal(savedDeck.cards.length, 2);

        // Verify Flashcard documents are created with deckId
        const savedCards = await Flashcard.find({ deckId: savedDeck._id });
        assert.equal(savedCards.length, 2, 'Two individual Flashcard documents must be linked to deckId');
        assert.equal(savedCards[0].front, 'What is Polymorphism?');
    });

    test('3. Consecutive generation creates a SECOND independent deck, without appending or overwriting', async () => {
        const mockAI1 = async () => ({
            text: JSON.stringify({
                flashcards: [
                    { front: 'Q1', back: 'A1' },
                    { front: 'Q2', back: 'A2' }
                ]
            })
        });
        const mockAI2 = async () => ({
            text: JSON.stringify({
                flashcards: [
                    { front: 'Q3', back: 'A3' },
                    { front: 'Q4', back: 'A4' },
                    { front: 'Q5', back: 'A5' }
                ]
            })
        });
        const mockRetriever = async () => [];

        const req1 = {
            user: { _id: testUserId1 },
            body: { subject: 'History', topic: 'Ancient Rome', count: 2, title: 'Rome Deck' }
        };
        const req2 = {
            user: { _id: testUserId1 },
            body: { subject: 'Physics', topic: 'Quantum Mechanics', count: 3, title: 'Physics Deck' }
        };

        let res1Data = null;
        const res1 = {
            status: () => res1,
            json: (d) => { res1Data = d; }
        };
        await generateFlashcards(req1, res1, () => {}, { generateAIContent: mockAI1, retrieveRelevantChunks: mockRetriever });

        let res2Data = null;
        const res2 = {
            status: () => res2,
            json: (d) => { res2Data = d; }
        };
        await generateFlashcards(req2, res2, () => {}, { generateAIContent: mockAI2, retrieveRelevantChunks: mockRetriever });

        // Verify two separate deck IDs exist
        assert.notEqual(res1Data.data._id.toString(), res2Data.data._id.toString(), 'Deck IDs must be unique');

        // Fetch all decks for user
        const allDecks = await FlashcardDeck.find({ userId: testUserId1 }).sort({ createdAt: 1 });
        assert.equal(allDecks.length, 2, 'User must have exactly 2 distinct decks');

        assert.equal(allDecks[0].title, 'Rome Deck');
        assert.equal(allDecks[0].cardCount, 2);
        assert.equal(allDecks[0].cards.length, 2);

        assert.equal(allDecks[1].title, 'Physics Deck');
        assert.equal(allDecks[1].cardCount, 3);
        assert.equal(allDecks[1].cards.length, 3);

        // Verify cards associated with deck 1 were NOT modified or appended to
        const deck1Cards = await Flashcard.find({ deckId: allDecks[0]._id });
        assert.equal(deck1Cards.length, 2, 'Deck 1 must retain exactly 2 cards');
        assert.equal(deck1Cards[0].front, 'Q1');
    });

    test('4. Failed generation does NOT create an empty deck', async () => {
        const mockFailingAI = async () => {
            throw new Error('AI Provider 503 Service Unavailable');
        };

        const req = {
            user: { _id: testUserId1 },
            body: { subject: 'Chemistry', topic: 'Acids & Bases', count: 5 }
        };

        let nextError = null;
        const res = {
            status: () => res,
            json: () => {}
        };

        await generateFlashcards(req, res, (err) => { nextError = err; }, {
            generateAIContent: mockFailingAI,
            retrieveRelevantChunks: async () => []
        });

        assert(nextError, 'Error should be passed to next middleware');

        // Verify NO deck was created in database
        const decks = await FlashcardDeck.find({ userId: testUserId1 });
        assert.equal(decks.length, 0, 'No deck must be created if generation fails');
    });

    test('5. Deleting a deck deletes ONLY that deck and its cards, preserving other decks', async () => {
        // Create Deck A
        const deckA = await FlashcardDeck.create({
            userId: testUserId1,
            title: 'Deck A',
            subject: 'Math',
            cardCount: 2,
            cards: [
                { front: '2+2', back: '4' },
                { front: '3+3', back: '6' }
            ]
        });
        await Flashcard.create([
            { _id: deckA.cards[0]._id, userId: testUserId1, deckId: deckA._id, subject: 'Math', front: '2+2', back: '4' },
            { _id: deckA.cards[1]._id, userId: testUserId1, deckId: deckA._id, subject: 'Math', front: '3+3', back: '6' }
        ]);

        // Create Deck B
        const deckB = await FlashcardDeck.create({
            userId: testUserId1,
            title: 'Deck B',
            subject: 'English',
            cardCount: 1,
            cards: [
                { front: 'Verb', back: 'Action word' }
            ]
        });
        await Flashcard.create([
            { _id: deckB.cards[0]._id, userId: testUserId1, deckId: deckB._id, subject: 'English', front: 'Verb', back: 'Action word' }
        ]);

        // Delete Deck A
        const deleteReq = {
            user: { _id: testUserId1 },
            params: { id: deckA._id.toString() }
        };
        let deleteResult = null;
        const deleteRes = {
            json: (d) => { deleteResult = d; }
        };

        await deleteDeck(deleteReq, deleteRes, () => {});
        assert(deleteResult.success, 'Delete must succeed');

        // Verify Deck A is gone
        const foundA = await FlashcardDeck.findById(deckA._id);
        assert.equal(foundA, null, 'Deck A must be deleted');
        const cardsA = await Flashcard.find({ deckId: deckA._id });
        assert.equal(cardsA.length, 0, 'Cards belonging to Deck A must be deleted');

        // Verify Deck B is untouched!
        const foundB = await FlashcardDeck.findById(deckB._id);
        assert(foundB, 'Deck B must still exist');
        assert.equal(foundB.title, 'Deck B');
        const cardsB = await Flashcard.find({ deckId: deckB._id });
        assert.equal(cardsB.length, 1, 'Deck B cards must remain untouched');
        assert.equal(cardsB[0].front, 'Verb');
    });

    test('6. User scoping: User 2 cannot access or delete User 1 deck', async () => {
        const deck1 = await FlashcardDeck.create({
            userId: testUserId1,
            title: 'User 1 Private Deck',
            subject: 'Private',
            cardCount: 1,
            cards: [{ front: 'Secret', back: 'Answer' }]
        });

        // User 2 attempts to get Deck 1
        const getReq = {
            user: { _id: testUserId2 },
            params: { id: deck1._id.toString() }
        };
        let getStatus = 200;
        const getRes = {
            status: (s) => { getStatus = s; return getRes; },
            json: () => {}
        };
        await getDeckById(getReq, getRes, () => {});
        assert.equal(getStatus, 404, 'User 2 should get 404 accessing User 1 deck');

        // User 2 attempts to delete Deck 1
        const delReq = {
            user: { _id: testUserId2 },
            params: { id: deck1._id.toString() }
        };
        let delStatus = 200;
        const delRes = {
            status: (s) => { delStatus = s; return delRes; },
            json: () => {}
        };
        await deleteDeck(delReq, delRes, () => {});
        assert.equal(delStatus, 404, 'User 2 cannot delete User 1 deck');

        // Verify Deck 1 still exists
        const check = await FlashcardDeck.findById(deck1._id);
        assert(check, 'User 1 deck must remain safe');
    });

    test('7. Backward compatibility: Legacy cards without deckId are safely migrated into a deck', async () => {
        // Create loose cards without deckId
        const card1 = await Flashcard.create({
            userId: testUserId1,
            subject: 'Legacy Subject',
            topic: 'Old Chapter',
            front: 'Legacy Q1',
            back: 'Legacy A1'
        });
        const card2 = await Flashcard.create({
            userId: testUserId1,
            subject: 'Legacy Subject',
            topic: 'Old Chapter',
            front: 'Legacy Q2',
            back: 'Legacy A2'
        });

        await ensureLegacyDecks(testUserId1);

        const decks = await FlashcardDeck.find({ userId: testUserId1 });
        assert.equal(decks.length, 1, 'Legacy cards must be grouped into 1 deck');
        assert.equal(decks[0].subject, 'Legacy Subject');
        assert.equal(decks[0].cardCount, 2);

        // Verify cards now have deckId
        const updated1 = await Flashcard.findById(card1._id);
        const updated2 = await Flashcard.findById(card2._id);
        assert.equal(updated1.deckId.toString(), decks[0]._id.toString());
        assert.equal(updated2.deckId.toString(), decks[0]._id.toString());
    });

    test('8. reviewFlashcard updates status on both Flashcard and FlashcardDeck', async () => {
        const deck = await FlashcardDeck.create({
            userId: testUserId1,
            title: 'Review Test Deck',
            subject: 'Science',
            cardCount: 1,
            cards: [{ front: 'What is H2O?', back: 'Water', status: 'New', reviewCount: 0 }]
        });
        const cardId = deck.cards[0]._id;
        await Flashcard.create({
            _id: cardId,
            userId: testUserId1,
            deckId: deck._id,
            subject: 'Science',
            front: 'What is H2O?',
            back: 'Water',
            status: 'New',
            reviewCount: 0
        });

        const req = {
            user: { _id: testUserId1 },
            params: { id: cardId.toString() },
            body: { status: 'Known' }
        };
        const res = {
            json: () => {}
        };
        await reviewFlashcard(req, res, () => {});

        const updatedCard = await Flashcard.findById(cardId);
        assert.equal(updatedCard.status, 'Known');
        assert.equal(updatedCard.reviewCount, 1);

        const updatedDeck = await FlashcardDeck.findById(deck._id);
        assert.equal(updatedDeck.cards[0].status, 'Known');
        assert.equal(updatedDeck.cards[0].reviewCount, 1);
    });
});
