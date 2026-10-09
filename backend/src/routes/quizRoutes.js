import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    generateQuiz,
    getQuizzes,
    getQuizById,
    submitQuiz,
    deleteQuiz
} from '../controllers/quizController.js';

const router = express.Router();

router.use(protect);

router.post('/generate', generateQuiz);
router.get('/', getQuizzes);
router.get('/:id', getQuizById);
router.post('/:id/submit', submitQuiz);
router.delete('/:id', deleteQuiz);

export default router;
