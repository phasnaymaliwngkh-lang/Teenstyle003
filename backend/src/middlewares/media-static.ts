import express, { type RequestHandler } from 'express';

import { uploadRoot } from '../config/media.ts';
import { MEDIA_KEY_PATTERN } from '../models/media.model.ts';

/**
 * เสิร์ฟไฟล์รูปที่ร้านเก็บเองที่ `/media/<storageKey>` (STEP 47)
 *
 * - **รับเฉพาะ path ที่ตรงรูปแบบที่ระบบสร้าง** (`MEDIA_KEY_PATTERN`) — อย่างอื่น 404 ทันที
 *   ไม่ต้องไปพึ่งว่า `express.static` จะกัน `..` / `%2e%2e` / ไฟล์ซ่อนได้ครบทุกแบบ
 * - **cache ได้ตลอดไป (`immutable`)** — ชื่อไฟล์เป็น id ใหม่ทุกครั้งที่อัปโหลด
 *   ไฟล์เดิมไม่เคยถูกเขียนทับ เปลี่ยนรูป = url ใหม่
 * - เนื้อไฟล์เป็น WebP ที่ระบบแปลงเองทุกไฟล์ (ไม่มีไฟล์ต้นฉบับของผู้ใช้) และ helmet ใส่ `nosniff` ให้แล้ว
 *
 * ⚠️ **ต้อง mount ก่อน `globalRateLimiter`** — เบราว์เซอร์และตัวย่อรูปของ Next ขอรูปผ่าน
 *    rewrite ของ frontend ซึ่งเป็นคำขอจาก IP ของ server frontend ตัวเดียว
 *    ถ้านับรวมกับ limit ต่อ IP ลูกค้าทั้งเว็บจะแชร์โควตาเดียวกันแล้วรูปหายทั้งร้าน (กฎ STEP 29)
 */
let staticHandler: RequestHandler | null = null;

function staticFiles(): RequestHandler {
  staticHandler ??= express.static(uploadRoot(), {
    dotfiles: 'deny',
    index: false,
    redirect: false,
    immutable: true,
    maxAge: '365d',
    setHeaders: (res) => {
      res.setHeader('Content-Disposition', 'inline');
    },
  });

  return staticHandler;
}

export const serveMedia: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  // req.path ที่นี่ไม่มี "/media" นำหน้าแล้ว (ตัดโดย app.use) เช่น "/products/2026/10/<id>.webp"
  if (!MEDIA_KEY_PATTERN.test(req.path.slice(1))) {
    next();
    return;
  }

  staticFiles()(req, res, next);
};
