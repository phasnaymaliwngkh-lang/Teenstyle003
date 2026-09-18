"use client";

import { CreditCard, Headphones, Package, RefreshCw, Truck } from "lucide-react";

interface CsQuickChipsProps {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

const PRESET_TOPICS = [
  {
    label: "เช็คสถานะพัสดุ",
    icon: Package,
    prompt: "ต้องการตรวจสอบสถานะพัสดุคำสั่งซื้อ",
  },
  {
    label: "ค่าส่งและระยะเวลา",
    icon: Truck,
    prompt: "ค่าจัดส่งเท่าไหร่ และใช้เวลากี่วันถึงครับ",
  },
  {
    label: "เปลี่ยน/คืนสินค้า",
    icon: RefreshCw,
    prompt: "นโยบายการเปลี่ยนไซซ์หรือคืนสินค้าเป็นอย่างไรครับ",
  },
  {
    label: "วิธีชำระเงิน",
    icon: CreditCard,
    prompt: "มีช่องทางการชำระเงินใดบ้าง และเก็บเงินปลายทางได้ไหม",
  },
  {
    label: "ติดต่อเจ้าหน้าที่คนจริง",
    icon: Headphones,
    prompt: "ขอคุยกับเจ้าหน้าที่คนจริงหน่อยครับ",
  },
];

export function CsQuickChips({ onSelectPrompt, disabled }: CsQuickChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 py-2">
      {PRESET_TOPICS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            disabled={disabled}
            onClick={() => onSelectPrompt(item.prompt)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft shadow-xs transition hover:border-brand hover:bg-lilac-50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon className="h-3.5 w-3.5 text-brand" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
