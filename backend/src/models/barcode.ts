import { gtinKind, isValidGtin } from '@teenstyle/database';
import bwipjs from 'bwip-js/node';

import { ApiError } from '../utils/api-error.ts';

/**
 * การวาดบาร์โค้ด / QR (STEP 17)
 *
 * ทำที่ฝั่ง server ทั้งหมด เพราะ
 *   1. **ต้องเป็นภาพชุดเดียวกันทุกเครื่อง** — ป้ายที่พิมพ์จากคอมหลังร้านกับจากแท็บเล็ต
 *      ต้องสแกนติดเหมือนกัน ถ้าปล่อยให้ browser วาดเอง ผลจะขึ้นกับเวอร์ชันของไลบรารีฝั่ง client
 *   2. **ค่าที่เข้ารหัสต้องมาจากฐานข้อมูล** ไม่ใช่จากสิ่งที่ client ส่งมา (กฎห้ามเชื่อ client)
 *
 * ใช้ `bwip-js` ซึ่งเป็น port ของ BWIPP (Barcode Writer in Pure PostScript) —
 * implementation อ้างอิงที่ใช้กันแพร่หลาย จึงไม่ต้องเขียนตารางสัญลักษณ์เอง
 * และ **มีเทสต์ถอดรหัส Code 128 กลับ** เพื่อยืนยันว่าเส้นที่วาดออกมาแทนค่าที่ต้องการจริง
 *
 * ⚠️ SVG ที่ได้ประกอบด้วย `<svg>` + `<path>` เท่านั้น (ตัวหนังสือใต้บาร์โค้ดถูกวาดเป็นเส้น
 *    ไม่ใช่ `<text>`) จึงไม่มีช่องให้ค่าที่เข้ารหัสหลุดออกมาเป็น markup
 *    แต่เรายัง**ตรวจรูปค่าก่อนวาดทุกครั้ง** เพื่อไม่ต้องพึ่งรายละเอียดภายในของไลบรารี
 */

/** สัญลักษณ์ที่ระบบรองรับ — ชื่อตรงกับ `bcid` ของ bwip-js */
export type Symbology = 'code128' | 'ean13' | 'ean8' | 'upca' | 'qrcode';

/** ค่าที่เข้ารหัสในบาร์โค้ดเส้นได้: SKU ของโปรเจกต์นี้ (A–Z, 0–9, ขีดกลาง) หรือตัวเลข GTIN */
const LINEAR_VALUE = /^[A-Z0-9][A-Z0-9-]{1,47}$/;

/** ขนาดของภาพที่ได้ อ่านจาก viewBox ของ SVG — ใช้กำหนดอัตราส่วนบนป้าย */
const VIEWBOX = /^<svg viewBox="0 0 (\d+) (\d+)"/;

export interface RenderedSymbol {
  symbology: Symbology;
  /** ค่าที่ถูกเข้ารหัสลงในภาพจริง */
  value: string;
  svg: string;
  width: number;
  height: number;
}

/** เลือกสัญลักษณ์ที่ถูกต้องตามความยาวของ GTIN (เครื่องสแกนที่ POS อ่าน EAN/UPC ได้ตรง ๆ) */
export function symbologyForGtin(value: string): Symbology | null {
  switch (gtinKind(value)) {
    case 'EAN-8':
      return 'ean8';
    case 'UPC-A':
      return 'upca';
    case 'EAN-13':
      return 'ean13';
    default:
      return null;
  }
}

/**
 * ตรวจว่าค่าที่จะเข้ารหัสเข้ากับสัญลักษณ์ที่เลือกจริง
 *
 * ปฏิเสธก่อนวาดเสมอ — ถ้าปล่อยให้ bwip-js throw เอง ข้อความ error จะเป็นภาษาอังกฤษดิบ
 * และ (สำคัญกว่า) เราจะไม่รู้ว่าค่าที่หลุดเข้ามามีรูปแบบอย่างไร
 */
function assertEncodable(symbology: Symbology, value: string): void {
  if (symbology === 'qrcode') {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw ApiError.badRequest('QR ของระบบนี้เข้ารหัสได้เฉพาะลิงก์ของหน้าสินค้า');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw ApiError.badRequest('ลิงก์ใน QR ต้องเป็น http หรือ https');
    }
    if (value.length > 300) {
      throw ApiError.badRequest('ลิงก์ใน QR ยาวเกินไป');
    }

    return;
  }

  if (symbology === 'code128') {
    if (!LINEAR_VALUE.test(value)) {
      throw ApiError.badRequest(
        'บาร์โค้ดเส้นเข้ารหัสได้เฉพาะตัวพิมพ์ใหญ่ ตัวเลข และขีดกลาง (รูปแบบเดียวกับ SKU)',
      );
    }

    return;
  }

  // ean13 / ean8 / upca — ต้องเป็น GTIN ที่ check digit ถูกต้องและความยาวตรงกับสัญลักษณ์
  if (!isValidGtin(value) || symbologyForGtin(value) !== symbology) {
    throw ApiError.badRequest(`บาร์โค้ด "${value}" ไม่ตรงกับมาตรฐาน ${symbology.toUpperCase()}`);
  }
}

/** ตัวเลือกการวาดต่อสัญลักษณ์ — แยกไว้ที่เดียวเพื่อให้ป้ายทุกใบหน้าตาเหมือนกัน */
function renderOptions(symbology: Symbology, value: string, showText: boolean) {
  if (symbology === 'qrcode') {
    return {
      bcid: 'qrcode' as const,
      text: value,
      scale: 4,
      // ระดับกันความเสียหาย M (~15%) — ป้ายกระดาษมีรอยยับ/หมึกจางได้
      eclevel: 'M',
      padding: 4,
      backgroundcolor: 'FFFFFF',
    };
  }

  return {
    bcid: symbology,
    text: value,
    scale: 3,
    /**
     * ความสูงของแถบเป็น **มิลลิเมตร**
     *   - GTIN (EAN/UPC): 15 มม. — ใกล้ขนาดที่ใช้บนป้ายห้อยสินค้าจริง
     *   - Code 128 ภายในร้าน: 12 มม. — พอสำหรับเครื่องสแกนมือถือ
     */
    height: symbology === 'code128' ? 12 : 15,
    includetext: showText,
    textxalign: 'center' as const,
    textsize: 9,
    /**
     * quiet zone (ขอบว่างซ้าย-ขวา) — Code 128 ต้องมีอย่างน้อย 10 โมดูล
     * ถ้าไม่เว้น เครื่องสแกนจะอ่านไม่ติดแม้ภาพจะดูถูกต้อง
     * ส่วน EAN/UPC ใช้ `guardwhitespace` ซึ่งวาดเครื่องหมาย ‹ › บอกขอบให้ตามมาตรฐาน
     */
    ...(symbology === 'code128'
      ? { paddingwidth: 10, paddingheight: 4 }
      : { guardwhitespace: true, paddingwidth: 4, paddingheight: 4 }),
    backgroundcolor: 'FFFFFF',
  };
}

/** วาดบาร์โค้ด/QR เป็น SVG — ค่าที่ส่งเข้ามาต้องมาจากฐานข้อมูลแล้วเท่านั้น */
export function renderSymbol(
  symbology: Symbology,
  value: string,
  options: { showText?: boolean } = {},
): RenderedSymbol {
  assertEncodable(symbology, value);

  let svg: string;
  try {
    svg = bwipjs.toSVG(renderOptions(symbology, value, options.showText ?? true));
  } catch (error) {
    // ถึงจุดนี้ค่าผ่านการตรวจแล้ว ถ้ายังวาดไม่ได้คือปัญหาฝั่งระบบ ไม่ใช่ input ของผู้ใช้
    throw ApiError.internal(
      `วาดบาร์โค้ดไม่สำเร็จ (${symbology}): ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  const size = VIEWBOX.exec(svg);

  return {
    symbology,
    value,
    svg,
    width: size === null ? 0 : Number(size[1]),
    height: size === null ? 0 : Number(size[2]),
  };
}
