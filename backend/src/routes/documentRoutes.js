import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js';
import {
    uploadDocument,
    getDocuments,
    getDocumentById,
    updateDocument,
    deleteDocument
} from '../controllers/documentController.js';

const router = express.Router();

router.use(protect); // All document routes require authentication

router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', getDocuments);
router.get('/:id', getDocumentById);
router.patch('/:id', updateDocument);
router.delete('/:id', deleteDocument);

export default router;
