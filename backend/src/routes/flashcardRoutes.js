import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { 
    generateFlashcards, 
    getFlashcards, 
    getDecks, 
    getDeckById, 
    reviewFlashcard, 
    deleteDeck, 
    deleteFlashcards 
} from '../controllers/flashcardController.js';

const router = express.Router();

router.use(protect);
router.post('/generate', generateFlashcards);
router.get('/decks', getDecks);
router.get('/decks/:id', getDeckById);
router.delete('/decks/:id', deleteDeck);
router.get('/', getFlashcards);
router.delete('/:id', deleteDeck);
router.delete('/', deleteFlashcards);
router.patch('/:id/review', reviewFlashcard);
router.put('/:id/review', reviewFlashcard);

export default router;
