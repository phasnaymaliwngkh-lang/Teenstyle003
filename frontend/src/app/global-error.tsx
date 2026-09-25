"use client";

/**
 * ตาข่ายชั้นสุดท้าย — ใช้เมื่อ **root layout เองพัง** (STEP 30)
 *
 * ตอนนี้ Next ยังเรนเดอร์ layout ปกติไม่ได้ จึงต้องมี `<html>` และ `<body>` ของตัวเอง
 * และ **ใช้ฟอนต์หรือ CSS ของแอปไม่ได้** เพราะทั้งคู่มาจาก root layout ที่พังไปแล้ว
 * → ทุกสไตล์ในไฟล์นี้จึงเขียน inline โดยเจตนา และห้าม import คอมโพเนนต์ที่พึ่ง token ของ globals.css
 * (ผิดกฎ "ห้าม hardcode ค่าสี" ตรงนี้ที่เดียว เพราะไม่มีทางอ่าน token ได้)
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f7f5ff",
          color: "#111114",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: "420px",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e9e7f0",
            borderRadius: "20px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: "0 0 12px", fontSize: "22px", lineHeight: 1.4 }}>
            เปิดเว็บไม่สำเร็จ
          </h1>
          <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#6b7280", lineHeight: 1.7 }}>
            เกิดข้อผิดพลาดร้ายแรงที่ทำให้แสดงหน้าเว็บไม่ได้ กรุณาลองโหลดใหม่อีกครั้ง
          </p>

          {error.digest && (
            <p
              style={{
                margin: "0 0 20px",
                padding: "12px 16px",
                background: "#f7f5ff",
                borderRadius: "16px",
                fontSize: "12px",
                color: "#2b2b33",
                wordBreak: "break-all",
              }}
            >
              รหัสอ้างอิงสำหรับแจ้งทีมงาน
              <br />
              <code style={{ color: "#5b21b6" }}>{error.digest}</code>
            </p>
          )}

          {/**
           * ใช้ `<a>` ธรรมดา **โดยเจตนา** ไม่ใช่ `<Link>` และไม่ใช่ `reset()`
           *
           * `<Link>` เปลี่ยนหน้าที่ client ซึ่งจะเรนเดอร์ root layout ที่พังอยู่ซ้ำอีกครั้ง
           * — ผู้ใช้จะกดแล้วเจอหน้าเดิม · การโหลดหน้าใหม่ทั้งหน้าคือทางเดียวที่มีโอกาสรอด
           * จึงปิดกฎ no-html-link-for-pages เฉพาะที่นี่
           */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: "inline-flex",
              minHeight: "48px",
              alignItems: "center",
              padding: "0 24px",
              borderRadius: "999px",
              background: "#7c3aed",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "14px",
              textDecoration: "none",
            }}
          >
            โหลดหน้าแรกใหม่
          </a>
        </div>
      </body>
    </html>
  );
}
