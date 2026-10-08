import type { PaymentMethodInfo } from '../config/payment.ts';

import {
  describeFreeShipping,
  describeShippingEta,
  describeShippingMethods,
  describeShippingRates,
  type ShippingOption,
} from './shipping.model.ts';
import {
  contactChannelsOf,
  describeContactChannels,
  formatCutoffTime,
  type StoreSettings,
} from './store-settings.model.ts';

/**
 * ตัวแปรนโยบายในบทความคลังความรู้ (STEP 44)
 *
 * บทความอยู่ในฐานข้อมูลและแอดมินแก้ได้ (STEP 21) ส่วนค่าส่งก็ย้ายเป็นข้อมูลที่ร้านแก้ได้แล้ว
 * ถ้าบทความเก็บตัวเลขค่าส่งเป็นข้อความตายตัว การแก้ค่าส่งครั้งแรกจะทำให้ AI สัญญากับลูกค้า
 * คนละอย่างกับที่ระบบเก็บเงิน (กฎกลางข้อ 3 · STEP 21 ข้อ 1)
 *
 * → บทความเก็บ **ตัวแปร** เช่น `{{shipping.rates}}` แล้ว backend แทนค่าจากตาราง `ShippingRate`
 *   **ทุกครั้งที่มีคนอ่าน** (หน้า /faq · คำตอบของ AI) — ไม่มีสำเนาตัวเลขที่ค้างค่าเก่าได้
 *
 * ⚠️ หน้าแก้บทความของแอดมินเห็นตัวแปรดิบ (ต้องแก้ได้) · ตัวแปรที่ไม่รู้จักถูกปฏิเสธตอนบันทึก
 *    ไม่ใช่ปล่อยให้ลูกค้าเห็น `{{shiping.rate}}` ที่พิมพ์ผิด
 */

export interface PolicyContext {
  shippingOptions: readonly ShippingOption[];
  /** การตั้งค่าร้าน (STEP 49) — ช่องทางติดต่อ เวลาทำการ จำนวนวันที่คืนได้ ยอดสูงสุดของ COD */
  store: StoreSettings;
  /** สถานะจริงของช่องทางชำระเงิน ณ ตอนที่อ่าน (เดิมบทความแช่สถานะไว้ตั้งแต่ตอน seed) */
  paymentMethods: readonly PaymentMethodInfo[];
}

/** รายการช่องทางชำระเงินพร้อมสถานะ — รูปเดียวกับที่บทความเคยพิมพ์ไว้ตอน seed */
export function describePaymentMethods(methods: readonly PaymentMethodInfo[]): string {
  return methods
    .map((method) => {
      const state = method.available
        ? '✅ เปิดให้ใช้งานแล้ว'
        : `⛔️ ยังไม่เปิดให้ใช้งาน${method.unavailableReason ? ` — ${method.unavailableReason}` : ''}`;

      return `- **${method.name}** — ${method.description}\n  สถานะ: ${state}`;
    })
    .join('\n');
}

interface PolicyToken {
  /** อธิบายให้แอดมินรู้ว่าตัวแปรนี้กลายเป็นอะไร */
  description: string;
  render: (context: PolicyContext) => string;
}

export const POLICY_TOKENS: Readonly<Record<string, PolicyToken>> = {
  'shipping.rates': {
    description: 'ตารางค่าส่งทุกวิธีที่เปิดใช้ (ค่าส่ง · ยอดส่งฟรี · ระยะเวลา · พื้นที่)',
    render: ({ shippingOptions }) => describeShippingRates(shippingOptions),
  },
  'shipping.free': {
    description: 'ประโยคเงื่อนไขส่งฟรี (ไม่มีโปรก็บอกว่าไม่มี)',
    render: ({ shippingOptions }) => describeFreeShipping(shippingOptions),
  },
  'shipping.eta': {
    description: 'ระยะเวลาจัดส่งของทุกวิธีในบรรทัดเดียว',
    render: ({ shippingOptions }) => describeShippingEta(shippingOptions),
  },
  'shipping.methods': {
    description: 'รายชื่อวิธีจัดส่งที่เลือกได้',
    render: ({ shippingOptions }) => describeShippingMethods(shippingOptions),
  },
  // ── การตั้งค่าร้าน (STEP 49) ──
  'store.contact': {
    description: 'รายการช่องทางติดต่อที่ร้านเปิดอยู่จริง (ช่องที่ไม่ได้ตั้งไว้จะไม่ถูกพูดถึง)',
    render: ({ store }) => describeContactChannels(contactChannelsOf(store)),
  },
  'store.agent_hours': {
    description: 'เวลาทำการของเจ้าหน้าที่คนจริง',
    render: ({ store }) => store.agentHours,
  },
  'store.shipping_days': {
    description: 'วันที่ร้านส่งของ',
    render: ({ store }) => store.shippingDays,
  },
  'store.cutoff_time': {
    description: 'เวลาตัดรอบส่งของ เช่น "12:00 น."',
    render: ({ store }) => formatCutoffTime(store.cutoffTime),
  },
  'returns.window_days': {
    description:
      'จำนวนวันที่แจ้งคืนได้ (ตัวเลขอย่างเดียว เขียน "ภายใน {{returns.window_days}} วัน")',
    render: ({ store }) => String(store.returnWindowDays),
  },
  'payment.cod_max': {
    description:
      'ยอดสูงสุดที่รับเก็บเงินปลายทาง (ตัวเลขอย่างเดียว เขียน "{{payment.cod_max}} บาท")',
    render: ({ store }) => store.codMaxTotal.toLocaleString('th-TH'),
  },
  'payment.methods': {
    description: 'รายการช่องทางชำระเงินพร้อมสถานะจริง ณ ตอนที่อ่าน',
    render: ({ paymentMethods }) => describePaymentMethods(paymentMethods),
  },
};

const TOKEN_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/** แทนตัวแปรที่รู้จักด้วยค่าจริง — ตัวที่ไม่รู้จักปล่อยไว้ตามเดิม (ตอนบันทึกถูกปฏิเสธไปแล้ว) */
export function renderPolicyTokens(text: string, context: PolicyContext): string {
  return text.replace(TOKEN_PATTERN, (whole, name: string) => {
    const token = POLICY_TOKENS[name];

    return token === undefined ? whole : token.render(context);
  });
}

/** ตัวแปรที่เขียนไว้แต่ระบบไม่รู้จัก (เช่นพิมพ์ผิด) — ไม่ซ้ำ เรียงตามที่เจอ */
export function unknownPolicyTokens(text: string): string[] {
  const unknown = new Set<string>();

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    if (POLICY_TOKENS[match[1]!] === undefined) unknown.add(match[0]);
  }

  return [...unknown];
}

/** รายการตัวแปรที่ใช้ได้ — ส่งให้หน้าแก้บทความแสดงเป็นคำอธิบาย */
export function policyTokenList(): { token: string; description: string }[] {
  return Object.entries(POLICY_TOKENS).map(([name, token]) => ({
    token: `{{${name}}}`,
    description: token.description,
  }));
}
