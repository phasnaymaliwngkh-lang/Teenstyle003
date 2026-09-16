import type { BarcodeKind, LabelItem, RequestedSymbology, Symbology } from "@/types/admin";

/**
 * ข้อความและตัวช่วยของระบบบาร์โค้ด (STEP 17)
 *
 * ⚠️ SVG ที่ backend วาดมาถูกแปลงเป็น data URL แล้วใส่ใน `<img>`
 *    **ไม่ใช้ `dangerouslySetInnerHTML`** — SVG ใน `<img>` ไม่มีสิทธิ์รันสคริปต์
 *    จึงไม่ต้องไปเชื่อว่าไลบรารีวาดภาพจะ escape ให้ครบทุกกรณี
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** ชื่อสัญลักษณ์ที่คนอ่านเข้าใจ */
export function symbologyLabel(symbology: Symbology): string {
  switch (symbology) {
    case "ean13":
      return "EAN-13";
    case "ean8":
      return "EAN-8";
    case "upca":
      return "UPC-A";
    case "qrcode":
      return "QR Code";
    case "code128":
      return "Code 128";
  }
}

/** ตัวเลือกที่ผู้ใช้กดได้ตอนสั่งพิมพ์ — อธิบายว่าสแกนแล้วจะได้อะไร */
export const SYMBOLOGY_CHOICES: {
  value: RequestedSymbology;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "บาร์โค้ดสินค้า",
    hint: "ใช้เลข EAN/UPC ถ้าตัวเลือกนั้นมี ไม่มีก็ใช้ Code 128 ของ SKU",
  },
  {
    value: "code128",
    label: "Code 128 (SKU)",
    hint: "รหัสภายในร้าน — สแกนแล้วได้ SKU เสมอ",
  },
  {
    value: "qrcode",
    label: "QR หน้าสินค้า",
    hint: "ป้ายบนชั้นวางให้ลูกค้าสแกนเปิดหน้าสินค้า",
  },
];

/** สแกนป้ายใบนี้แล้วจะได้อะไร — ต้องบอกให้ชัดก่อนพิมพ์เป็นปึก */
export function encodesLabel(item: LabelItem): string {
  switch (item.encodes) {
    case "GTIN":
      return "สแกนได้เลขบาร์โค้ดสินค้า";
    case "SKU":
      return "สแกนได้ SKU ของร้าน";
    case "PRODUCT_URL":
      return "สแกนแล้วเปิดหน้าสินค้า";
  }
}

/** อธิบายว่าระบบหาเจอจากอะไร — กันความเข้าใจผิดว่าสแกนบาร์โค้ดเจอทั้งที่จริงเจอจาก SKU */
export function matchedByLabel(matchedBy: "BARCODE" | "VARIANT_SKU" | "PRODUCT_SKU"): string {
  switch (matchedBy) {
    case "BARCODE":
      return "ตรงกับบาร์โค้ดของตัวเลือกสินค้า";
    case "VARIANT_SKU":
      return "ตรงกับ SKU ของตัวเลือกสินค้า";
    case "PRODUCT_SKU":
      return "ตรงกับ SKU ของสินค้า (ยังไม่ระบุสี/ไซซ์)";
  }
}

/** คำอธิบายบาร์โค้ดที่เก็บไว้ของตัวเลือกหนึ่งตัว */
export function barcodeKindLabel(kind: BarcodeKind | null, barcode: string | null): string {
  if (barcode === null) return "ยังไม่มีบาร์โค้ด";
  // เลขที่เก็บไว้แต่ check digit ไม่ผ่าน = สแกนไม่ติด ต้องบอกตรง ๆ ไม่ใช่โชว์เฉย ๆ
  if (kind === null) return "เลขที่บันทึกไว้ใช้สแกนไม่ได้ (หลักตรวจสอบไม่ถูกต้อง)";

  return kind;
}
