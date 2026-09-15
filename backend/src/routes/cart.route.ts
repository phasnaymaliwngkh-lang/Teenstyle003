import { Router } from 'express';

import {
  addCartItemHandler,
  addLookHandler,
  clearCartHandler,
  getCartHandler,
  mergeCartHandler,
  removeCartItemHandler,
  selectCartItemHandler,
  updateCartItemHandler,
} from '../controllers/cart.controller.ts';
import { attachUser, requireAuth } from '../middlewares/authenticate.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * Route ของตะกร้า (STEP 9)
 *
 * - `attachUser` ทุกเส้นทาง: ตะกร้าใช้ได้ทั้งแบบล็อกอินและ guest
 * - `verifyOrigin` ทุกเส้นทาง: คำขอที่เปลี่ยนข้อมูลต้องมาจาก origin ของเราเอง (กัน CSRF)
 * - `/merge` เท่านั้นที่บังคับล็อกอิน เพราะต้องรู้ว่าจะรวมเข้าบัญชีใคร
 */
export const cartRouter = Router();

cartRouter.use(attachUser, verifyOrigin);

cartRouter.get('/', getCartHandler);
cartRouter.post('/items', addCartItemHandler);
cartRouter.patch('/items/:itemId', updateCartItemHandler);
cartRouter.patch('/items/:itemId/select', selectCartItemHandler);
cartRouter.delete('/items/:itemId', removeCartItemHandler);
cartRouter.post('/looks/:slug', addLookHandler);
cartRouter.post('/merge', requireAuth, mergeCartHandler);
cartRouter.delete('/', clearCartHandler);
