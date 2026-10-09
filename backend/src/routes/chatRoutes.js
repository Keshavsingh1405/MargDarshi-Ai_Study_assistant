import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createChat,
    getChats,
    getChatById,
    deleteChat,
    sendMessage
} from '../controllers/chatController.js';

const router = express.Router();

router.use(protect);

router.post('/', createChat);
router.get('/', getChats);
router.get('/:id', getChatById);
router.delete('/:id', deleteChat);
router.post('/message', sendMessage);

export default router;
