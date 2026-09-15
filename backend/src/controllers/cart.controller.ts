import type { CookieOptions, Request, Response } from 'express';

import { isProduction } from '../config/env.ts';
import { emptyCart } from '../models/cart.model.ts';
import {
  addItem,
  addLookToCart,
  clearCart,
  createGuestToken,
  getCart,
  mergeGuestCart,
  removeItem,
  setItemSelected,
  updateItemQuantity,
  type CartOwner,
} from '../services/cart.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  addCartItemSchema,
  addLookToCartSchema,
  cartItemParamsSchema,
  lookSlugParamsSchema,
  selectCartItemSchema,
  updateCartItemSchema,
} from '../validators/cart.validator.ts';

/**
 * Endpoint ของตะกร้า (STEP 9) — ใช้ได้ทั้งตอนล็อกอินและยังไม่ล็อกอิน
 *
 * การระบุตัวตนของตะกร้า
 *   - ล็อกอินแล้ว → ใช้ `req.user.id` (มาจาก attachUser: Bearer token หรือ session cookie)
 *   - ยังไม่ล็อกอิน → ใช้ cookie `cart-token` (httpOnly ผู้ใช้อ่าน/แก้เองไม่ได้)
 *     คำขอที่ "เพิ่มของ" จะออก token ให้ถ้ายังไม่มี · คำขอที่แค่อ่านไม่สร้าง token
 *     (ไม่อยากสร้างตะกร้าเปล่าให้ bot ทุกตัวที่เข้ามาดู)
 *
 * ⚠️ ทุก mutation ผ่าน verifyOrigin (กัน CSRF) และ service ตรวจความเป็นเจ้าของอีกชั้น
 */

export const CART_COOKIE = 'cart-token';

const COOKIE_DAYS = 30;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // production: frontend/backend อยู่ต่างโดเมน จึงต้อง None + Secure
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
    maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000,
  };
}

function readGuestToken(req: Request): string | null {
  const value = req.cookies?.[CART_COOKIE];
  return typeof value === 'string' && value.length >= 20 ? value : null;
}

/** เจ้าของตะกร้าสำหรับ "อ่าน" — ไม่สร้าง token ใหม่ */
function readOwner(req: Request): CartOwner | null {
  if (req.user) return { userId: req.user.id };

  const guestToken = readGuestToken(req);
  return guestToken === null ? null : { guestToken };
}

/** เจ้าของตะกร้าสำหรับ "เขียน" — ออก token ใหม่ให้ guest ถ้ายังไม่มี */
function writeOwner(req: Request, res: Response): CartOwner {
  if (req.user) return { userId: req.user.id };

  const existing = readGuestToken(req);
  if (existing !== null) return { guestToken: existing };

  const guestToken = createGuestToken();
  res.cookie(CART_COOKIE, guestToken, cookieOptions());

  return { guestToken };
}

/** GET /api/cart */
export const getCartHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const owner = readOwner(req);

  // ยังไม่มีตะกร้าเลย → ตะกร้าเปล่า (ไม่แตะฐานข้อมูล ไม่ตั้ง cookie)
  const cart = owner === null ? emptyCart(true) : await getCart(owner);

  sendSuccess(res, cart);
});

/** POST /api/cart/items — { variantId, quantity } */
export const addCartItemHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { variantId, quantity } = addCartItemSchema.parse(req.body);
    const owner = writeOwner(req, res);

    const cart = await addItem(owner, variantId, quantity);

    sendSuccess(res, cart, 'เพิ่มลงตะกร้าแล้ว', 201);
  },
);

/** PATCH /api/cart/items/:itemId — { quantity } */
export const updateCartItemHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { itemId } = cartItemParamsSchema.parse(req.params);
    const { quantity } = updateCartItemSchema.parse(req.body);
    const owner = writeOwner(req, res);

    const cart = await updateItemQuantity(owner, itemId, quantity);

    sendSuccess(res, cart, 'แก้จำนวนแล้ว');
  },
);

/** PATCH /api/cart/items/:itemId/select — { selected } */
export const selectCartItemHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { itemId } = cartItemParamsSchema.parse(req.params);
    const { selected } = selectCartItemSchema.parse(req.body);
    const owner = writeOwner(req, res);

    const cart = await setItemSelected(owner, itemId, selected);

    sendSuccess(res, cart);
  },
);

/** DELETE /api/cart/items/:itemId */
export const removeCartItemHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { itemId } = cartItemParamsSchema.parse(req.params);
    const owner = writeOwner(req, res);

    const cart = await removeItem(owner, itemId);

    sendSuccess(res, cart, 'ลบออกจากตะกร้าแล้ว');
  },
);

/** DELETE /api/cart */
export const clearCartHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const owner = writeOwner(req, res);

  const cart = await clearCart(owner);

  sendSuccess(res, cart, 'ล้างตะกร้าแล้ว');
});

/** POST /api/cart/looks/:slug — { selections: [{ variantId, quantity }] } */
export const addLookHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { slug } = lookSlugParamsSchema.parse(req.params);
  const { selections } = addLookToCartSchema.parse(req.body);
  const owner = writeOwner(req, res);

  const result = await addLookToCart(owner, slug, selections);

  sendSuccess(
    res,
    result,
    result.skipped.length === 0
      ? 'เพิ่มทั้งชุดลงตะกร้าแล้ว'
      : `เพิ่มได้ ${result.addedCount} ชิ้น · ข้าม ${result.skipped.length} ชิ้น`,
    result.addedCount > 0 ? 201 : 200,
  );
});

/**
 * POST /api/cart/merge — รวมตะกร้า guest เข้าบัญชีตอนล็อกอิน (ต้องล็อกอิน)
 *
 * เรียกจากหน้า /after-signin ฝั่ง server ของ Next.js
 * เรียกซ้ำได้ไม่มีผลข้างเคียง เพราะตะกร้า guest ถูกลบทิ้งหลังรวมสำเร็จ
 */
export const mergeCartHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // requireAuth การันตีว่ามี req.user แล้ว
  const userId = req.user!.id;
  const guestToken = readGuestToken(req);

  if (guestToken === null) {
    sendSuccess(res, { cart: await getCart({ userId }), mergedCount: 0, clampedCount: 0 });
    return;
  }

  const result = await mergeGuestCart(userId, guestToken);

  // ล้าง cookie ของ guest ทิ้ง — ตะกร้านั้นถูกรวมและลบไปแล้ว
  res.clearCookie(CART_COOKIE, { ...cookieOptions(), maxAge: undefined });

  sendSuccess(
    res,
    result,
    result.mergedCount > 0
      ? `รวมตะกร้าเข้าบัญชีแล้ว ${result.mergedCount} รายการ`
      : 'ไม่มีอะไรต้องรวม',
  );
});
