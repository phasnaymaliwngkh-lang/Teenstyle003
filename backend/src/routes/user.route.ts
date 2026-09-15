import { Router } from 'express';

import { getMe } from '../controllers/user.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';

export const userRouter = Router();

/** ทุก route ใต้ /api/users ต้องล็อกอิน */
userRouter.use(requireAuth);

userRouter.get('/me', getMe);
