import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getProgress, getSubjectProgress, getTopicProgress, logStudySession } from '../controllers/progressController.js';

const router = express.Router();

router.use(protect);

router.get('/', getProgress);
router.get('/subjects', getSubjectProgress);
router.get('/topics', getTopicProgress);
router.post('/session', logStudySession);

export default router;
