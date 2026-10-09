import Flashcard from '../models/Flashcard.js';
import FlashcardDeck from '../models/FlashcardDeck.js';
import { retrieveRelevantChunks } from '../services/rag/retrievalService.js';
import { generateAIContent } from '../services/ai/aiService.js';
import { FLASHCARD_PROMPT } from '../prompts/flashcardPrompt.js';

export const formatDeckDate = (date = new Date()) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${month} ${day}, ${year} — ${hours}:${minutes} ${ampm}`;
};

export const generateDefaultDeckTitle = (subject, topic, date = new Date()) => {
    const cleanSub = (subject || 'General').trim();
    const cleanTopic = (topic || '').trim();
    const prefix = cleanTopic ? `${cleanSub}: ${cleanTopic}` : cleanSub;
    return `${prefix} — ${formatDeckDate(date)}`;
};

export const ensureLegacyDecks = async (userId) => {
    try {
        const looseCards = await Flashcard.find({
            userId,
            $or: [
                { deckId: { $exists: false } },
                { deckId: null }
            ]
        });

        if (!looseCards || looseCards.length === 0) return;

        // Group cards by subject & topic
        const groupMap = {};
        for (const card of looseCards) {
            const key = `${card.subject || 'General'}|||${card.topic || ''}`;
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(card);
        }

        for (const [key, cards] of Object.entries(groupMap)) {
            const [subject, topic] = key.split('|||');
            const createdDate = cards[0]?.createdAt || new Date();
            const title = generateDefaultDeckTitle(subject, topic, new Date(createdDate));

            const deck = await FlashcardDeck.create({
                userId,
                title,
                subject,
                topic,
                cardCount: cards.length,
                cards: cards.map(c => ({
                    _id: c._id,
                    front: c.front,
                    back: c.back,
                    status: c.status || 'New',
                    reviewCount: c.reviewCount || 0,
                    lastReviewedAt: c.lastReviewedAt
                })),
                createdAt: createdDate
            });

            await Flashcard.updateMany(
                { _id: { $in: cards.map(c => c._id) } },
                { $set: { deckId: deck._id } }
            );
        }
    } catch (err) {
        console.error('Error migrating legacy flashcards:', err);
    }
};

export const generateFlashcards = async (req, res, next, services = {}) => {
    try {
        const { subject, topic, count = 5, title, customTitle } = req.body;
        const retriever = services.retrieveRelevantChunks || retrieveRelevantChunks;
        const aiGenerator = services.generateAIContent || generateAIContent;

        const cleanSubject = (subject || '').trim();
        const cleanTopic = (topic || '').trim();

        if (!cleanSubject) {
            return res.status(400).json({
                success: false,
                message: 'Subject is required to generate flashcards.'
            });
        }

        const namespace = `user_${req.user._id}`;
        const query = cleanTopic || cleanSubject || 'key concepts';
        
        let contextString = '';
        try {
            const chunks = await retriever(query, namespace, 10, cleanSubject !== 'All' ? cleanSubject : null);
            if (chunks && chunks.length > 0) {
                contextString = chunks.map(c => c.text).join('\n\n');
            }
        } catch (retrievalError) {
            console.warn('[Flashcards] Retrieval warning:', retrievalError.message);
        }

        if (!contextString) {
            contextString = "Use general academic knowledge for this topic.";
        }

        const prompt = FLASHCARD_PROMPT
            .replace('{subject}', cleanSubject)
            .replace('{topic}', cleanTopic)
            .replace('{count}', count)
            .replace('{context}', contextString);

        const response = await aiGenerator({
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        if (!response || !response.text) {
            return res.status(503).json({
                success: false,
                message: 'AI service returned empty response. Deck creation aborted.'
            });
        }

        let flashcardData;
        try {
            flashcardData = JSON.parse(response.text);
        } catch (e) {
            const cleaned = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
            flashcardData = JSON.parse(cleaned);
        }

        if (!flashcardData || !Array.isArray(flashcardData.flashcards) || flashcardData.flashcards.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'No flashcard items could be generated from the given topic. Please refine your prompt.'
            });
        }

        // Determine deck title (use user custom title if provided, else auto-generate)
        const userTitle = (title || customTitle || '').trim();
        const deckTitle = userTitle || generateDefaultDeckTitle(cleanSubject, cleanTopic);

        // 1. Create independent FlashcardDeck document
        const deck = new FlashcardDeck({
            userId: req.user._id,
            title: deckTitle,
            subject: cleanSubject,
            topic: cleanTopic,
            cardCount: flashcardData.flashcards.length,
            cards: flashcardData.flashcards.map(fc => ({
                front: fc.front,
                back: fc.back,
                status: 'New',
                reviewCount: 0
            }))
        });

        await deck.save();

        // 2. Keep individual Flashcard documents synchronized with deckId
        const createdCards = [];
        for (let i = 0; i < deck.cards.length; i++) {
            const item = deck.cards[i];
            const card = await Flashcard.create({
                _id: item._id,
                userId: req.user._id,
                deckId: deck._id,
                subject: cleanSubject,
                topic: cleanTopic,
                front: item.front,
                back: item.back,
                status: 'New',
                reviewCount: 0
            });
            createdCards.push(card);
        }

        res.status(201).json({ success: true, data: deck });
    } catch (error) {
        next(error);
    }
};

export const getDecks = async (req, res, next) => {
    try {
        await ensureLegacyDecks(req.user._id);
        const decks = await FlashcardDeck.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: decks });
    } catch (error) {
        next(error);
    }
};

export const getFlashcards = async (req, res, next) => {
    try {
        await ensureLegacyDecks(req.user._id);
        if (req.query.deckId) {
            const deck = await FlashcardDeck.findOne({ _id: req.query.deckId, userId: req.user._id });
            if (!deck) {
                return res.status(404).json({ success: false, message: 'Deck not found' });
            }
            return res.json({ success: true, data: deck.cards });
        }
        // By default return all decks
        const decks = await FlashcardDeck.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: decks });
    } catch (error) {
        next(error);
    }
};

export const getDeckById = async (req, res, next) => {
    try {
        const deck = await FlashcardDeck.findOne({ _id: req.params.id, userId: req.user._id });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Flashcard deck not found' });
        }
        res.json({ success: true, data: deck });
    } catch (error) {
        next(error);
    }
};

export const deleteDeck = async (req, res, next) => {
    try {
        const deckId = req.params.id;
        const deck = await FlashcardDeck.findOneAndDelete({ _id: deckId, userId: req.user._id });
        
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Flashcard deck not found' });
        }

        // Delete only the cards associated with this specific deck ID
        await Flashcard.deleteMany({ deckId, userId: req.user._id });

        res.json({ success: true, message: 'Deck and its associated cards deleted successfully.' });
    } catch (error) {
        next(error);
    }
};

export const deleteFlashcards = async (req, res, next) => {
    try {
        if (req.params.id) {
            return deleteDeck(req, res, next);
        }
        await FlashcardDeck.deleteMany({ userId: req.user._id });
        await Flashcard.deleteMany({ userId: req.user._id });
        res.json({ success: true, message: 'All flashcard decks deleted.' });
    } catch (error) {
        next(error);
    }
};

export const reviewFlashcard = async (req, res, next) => {
    try {
        const { status } = req.body; // 'New', 'Learning', 'Known'
        const cardId = req.params.id;

        const flashcard = await Flashcard.findOne({ _id: cardId, userId: req.user._id });
        if (flashcard) {
            flashcard.status = status;
            flashcard.reviewCount += 1;
            flashcard.lastReviewedAt = new Date();
            await flashcard.save();
        }

        const deck = await FlashcardDeck.findOneAndUpdate(
            { userId: req.user._id, "cards._id": cardId },
            {
                $set: {
                    "cards.$.status": status,
                    "cards.$.lastReviewedAt": new Date()
                },
                $inc: {
                    "cards.$.reviewCount": 1
                }
            },
            { new: true }
        );

        if (!flashcard && !deck) {
            return res.status(404).json({ success: false, message: 'Flashcard not found' });
        }

        const updatedCard = flashcard || deck?.cards.id(cardId);
        res.json({ success: true, data: updatedCard });
    } catch (error) {
        next(error);
    }
};
