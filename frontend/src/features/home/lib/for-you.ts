import type { ForYouResult, RecommendationFallbackReason } from "@/types/recommendation";

/**
 * หัวข้อของส่วน "แนะนำสำหรับคุณ" บนหน้าแรก (STEP 46) — ฟังก์ชันบริสุทธิ์ เทสต์ได้ตรง ๆ
 *
 * ⚠️ **โหมดยอดนิยมห้ามเรียกตัวเองว่า "สำหรับคุณ"** — มันไม่ได้ใช้ประวัติของใครเลย
 *    การติดป้าย "สำหรับคุณ" ให้รายการที่ทุกคนเห็นเหมือนกันคือการบอกลูกค้าว่าระบบรู้จักเขา ซึ่งไม่จริง
 *    (โดยเฉพาะคนที่ **ปิดการแนะนำไว้** — ถ้าหัวข้อยังเขียนว่า "สำหรับคุณ" เขาจะเข้าใจว่าสวิตช์ไม่มีผล)
 */
const POPULAR_SUBTITLE: Record<RecommendationFallbackReason, string> = {
  GUEST:
    "เรียงจากจำนวนคนที่กดถูกใจ ยอดขายจริง และการเข้าชม — เข้าสู่ระบบแล้วจะแนะนำจากสิ่งที่คุณสั่งซื้อ ถูกใจ และใส่ตะกร้า",
  NO_HISTORY:
    "คุณยังไม่มีประวัติในร้าน จึงแสดงสินค้ายอดนิยมก่อน — กดถูกใจหรือสั่งซื้อแล้ว ส่วนนี้จะแนะนำจากสิ่งที่คุณสนใจ",
  NO_MATCH: "ยังไม่มีสินค้าที่พร้อมขายและใกล้กับสิ่งที่คุณสนใจ จึงแสดงสินค้ายอดนิยมแทน",
  OPTED_OUT: "คุณปิดการแนะนำจากพฤติกรรมไว้ — ระบบจึงไม่อ่านประวัติของคุณ และแสดงสินค้ายอดนิยมแทน",
};

const PERSONAL_SUBTITLE =
  "เลือกจากสิ่งที่คุณสั่งซื้อ ถูกใจ ใส่ตะกร้า และรีวิว — ใต้การ์ดแต่ละใบบอกเหตุผลที่แนะนำ";

export interface ForYouHeading {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** แสดงเหตุผลใต้การ์ดไหม — โหมดยอดนิยมทุกใบคือ "ยอดนิยมในร้าน" ซ้ำกับหัวข้อ */
  showReasons: boolean;
  /** ลิงก์ไปเปิดสวิตช์ — เฉพาะคนที่ปิดไว้ */
  showOptInLink: boolean;
}

export function forYouHeading(result: ForYouResult): ForYouHeading {
  if (result.mode === "PERSONAL") {
    return {
      eyebrow: "For You",
      title: "แนะนำสำหรับคุณ",
      subtitle: PERSONAL_SUBTITLE,
      showReasons: true,
      showOptInLink: false,
    };
  }

  const reason = result.fallbackReason ?? "NO_MATCH";

  return {
    eyebrow: "Popular",
    title: "ยอดนิยมในร้าน",
    subtitle: POPULAR_SUBTITLE[reason],
    showReasons: false,
    showOptInLink: reason === "OPTED_OUT",
  };
}
