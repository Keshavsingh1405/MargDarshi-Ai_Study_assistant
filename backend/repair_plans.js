import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import mongoose from 'mongoose';
import StudyPlan from './src/models/StudyPlan.js';

mongoose.connect(process.env.MONGODB_URI);

async function repairPlans() {
    const plans = await StudyPlan.find();
    for (const p of plans) {
        let changed = false;
        // If dailyStudyTime is less than 24, it means it was saved as hours instead of minutes
        if (p.dailyStudyTime && p.dailyStudyTime < 24) {
            p.dailyStudyTime = p.dailyStudyTime * 60;
            changed = true;
        }
        for (const day of p.plan) {
            for (const t of day.tasks) {
                // If duration is suspiciously small (like 3), multiply by 60
                if (t.duration && t.duration < 24) {
                    t.duration = t.duration * 60;
                    changed = true;
                }
            }
        }
        if (changed) {
            await p.save();
            console.log(`Repaired plan: ${p._id}`);
        }
    }
    process.exit(0);
}
repairPlans();
