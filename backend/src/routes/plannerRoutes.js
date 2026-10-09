import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { 
    generateStudyPlan, 
    getStudyPlans, 
    getStudyPlanById, 
    regenerateStudyPlan, 
    updateStudyPlan, 
    deleteStudyPlan 
} from '../controllers/plannerController.js';

const router = express.Router();

router.use(protect);

router.post('/generate', generateStudyPlan);
router.get('/', getStudyPlans);
router.get('/:id', getStudyPlanById);
router.post('/:id/regenerate', regenerateStudyPlan);
router.patch('/:id', updateStudyPlan);
router.put('/:id', updateStudyPlan); // Added PUT since frontend is using PUT
router.delete('/:id', deleteStudyPlan);

export default router;
