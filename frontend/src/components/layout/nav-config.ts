/**
 * แหล่งข้อมูลเดียวของเมนู — navbar (desktop), mobile menu และ footer อ่านจากที่นี่
 * แก้ที่เดียวแล้วเปลี่ยนทุกที่ (กันเมนูไม่ตรงกัน)
 */

export interface NavItem {
  label: string;
  /**
   * ถ้าไม่ใส่ = ยังไม่มีหน้านั้นจริง จะถูกแสดงเป็นข้อความพร้อมป้าย STEP แทนลิงก์
   * (ไม่ลิงก์ไปหน้า 404 — ใส่ href เฉพาะเส้นทางที่มีหน้าอยู่จริงเท่านั้น)
   */
  href?: string;
  /** STEP ที่จะสร้างเนื้อหาจริงของหน้านี้ */
  pendingStep?: number;
}

/** เมนูหลักตามที่ STEP 4 กำหนด — ทุกอันมีหน้ารองรับแล้ว (บางหน้ายังเป็น placeholder) */
export const MAIN_NAV: readonly (NavItem & { href: string })[] = [
  { label: "Home", href: "/" },
  { label: "Shop", href: "/shop" },
  { label: "Looks", href: "/looks" },
  { label: "AI Stylist", href: "/ai-stylist", pendingStep: 19 },
  { label: "About", href: "/about", pendingStep: 49 },
];

/** ลิงก์ในส่วนท้ายเว็บ */
export const FOOTER_SECTIONS: readonly {
  title: string;
  links: readonly NavItem[];
}[] = [
  {
    title: "About TeenStyle AI",
    links: [
      { label: "เกี่ยวกับเรา", href: "/about", pendingStep: 49 },
      { label: "Shop", href: "/shop" },
      { label: "Popular Looks", href: "/looks" },
      { label: "AI Stylist", href: "/ai-stylist", pendingStep: 19 },
    ],
  },
  {
    title: "Customer Service",
    links: [
      { label: "AI Customer Service", pendingStep: 20 },
      { label: "คำถามที่พบบ่อย", pendingStep: 49 },
      { label: "Shipping — การจัดส่ง", pendingStep: 44 },
      { label: "Return Policy — การคืนสินค้า", pendingStep: 43 },
    ],
  },
  {
    title: "บัญชีของฉัน",
    links: [
      { label: "บัญชีของฉัน", href: "/account" },
      { label: "ตะกร้าสินค้า", href: "/cart" },
      { label: "Wishlist", href: "/wishlist", pendingStep: 22 },
      { label: "ประวัติคำสั่งซื้อ", href: "/account/orders" },
    ],
  },
  {
    title: "ข้อกำหนด",
    links: [
      { label: "Privacy Policy", pendingStep: 53 },
      { label: "Terms of Service", pendingStep: 53 },
      { label: "Cookie Consent", pendingStep: 53 },
    ],
  },
];

/** โซเชียลมีเดีย — STEP 49 จะย้ายไปตั้งค่าใน Store Settings */
export const SOCIAL_LINKS: readonly { label: string; href: string }[] = [
  { label: "Instagram", href: "https://instagram.com" },
  { label: "TikTok", href: "https://tiktok.com" },
  { label: "Facebook", href: "https://facebook.com" },
  { label: "LINE", href: "https://line.me" },
];
