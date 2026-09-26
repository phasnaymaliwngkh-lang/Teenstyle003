import { ImageResponse } from "next/og";

/**
 * ภาพที่แสดงตอนแชร์ลิงก์ (og:image) — สร้างด้วย next/og (STEP 33)
 *
 * ทุกหน้าที่ไม่ได้กำหนดภาพของตัวเองจะใช้ภาพนี้ (หน้าสินค้า/ลุคใช้รูปสินค้าจริงแทน)
 *
 * ⚠️ **ข้อความในภาพเป็นอังกฤษล้วนโดยเจตนา** — Satori (ตัวเรนเดอร์ของ next/og)
 *    ไม่มีฟอนต์ไทยและอีโมจิมาให้ ถ้าใส่ภาษาไทยจะออกมาเป็นสี่เหลี่ยมเปล่า
 *    การแก้ต้องโหลดไฟล์ฟอนต์เข้ามาเอง ซึ่งจะทำให้ route นี้พึ่งเน็ตตอนสร้างภาพ
 *    (ออฟไลน์แล้วภาพแชร์พังทั้งเว็บ) — ยังไม่คุ้มกับแค่การใส่ข้อความไทยหนึ่งบรรทัด
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TEENSTYLE AI — Find your style, be you";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        // สีตรงกับ token --color-brand / --color-brand-light ของ globals.css
        backgroundImage: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #5b21b6 100%)",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -2 }}>TEENSTYLE</div>
        <div style={{ fontSize: 88, color: "#ede9fe" }}>AI</div>
      </div>

      <div style={{ marginTop: 10, fontSize: 40, color: "#ede9fe" }}>Find your style, be you</div>

      <div
        style={{
          marginTop: 42,
          display: "flex",
          padding: "14px 34px",
          borderRadius: 999,
          border: "2px solid rgba(255,255,255,0.45)",
          fontSize: 26,
          letterSpacing: 1,
        }}
      >
        Fashion e-commerce with an AI stylist
      </div>
    </div>,
    size,
  );
}
