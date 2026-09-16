"use client";

import { Sparkles } from "lucide-react";

import type { StylistPreferences } from "@/types/catalog";

interface PresetOption {
  label: string;
  prompt: string;
  preferences?: StylistPreferences;
}

const PRESETS: PresetOption[] = [
  {
    label: "☕ มินิมอลไปคาเฟ่",
    prompt: "ช่วยแนะนำชุดสไตล์ Minimal ไปนั่งชิลที่คาเฟ่ โทนสีเรียบง่าย งบไม่เกิน 1,500 บาท",
    preferences: { style: "minimal", occasion: "คาเฟ่", maxBudget: 1500 },
  },
  {
    label: "🛹 สตรีทแวร์เท่ ๆ",
    prompt: "อยากได้ลุค Streetwear เท่ ๆ แมตช์โทนสีดำ พร้อมใส่เที่ยวสยาม",
    preferences: { style: "streetwear", color: "ดำ" },
  },
  {
    label: "✨ เกาหลี Korean Chic",
    prompt: "แนะนำชุดสไตล์เกาหลี Korean Chic ไปเดทวันหยุด ดูดีมีคลาส",
    preferences: { style: "korean", occasion: "เดท" },
  },
  {
    label: "🌈 Y2K สดใส",
    prompt: "อยากแต่งตัวสไตล์ Y2K สดใส มีกิมมิกสนุก ๆ งบไม่เกิน 2,000 บาท",
    preferences: { style: "y2k", maxBudget: 2000 },
  },
  {
    label: "💼 Smart Casual ไปเรียน/ทำงาน",
    prompt: "ช่วยจัดชุด Smart Casual เรียบร้อยแต่ยังดูแฟชั่นสำหรับไปเรียนหรือทำงาน",
    preferences: { style: "casual", occasion: "ทำงาน" },
  },
  {
    label: "👕 เสื้อยืด Oversize + ยีนส์",
    prompt: "แนะนำเสื้อยืด Oversize ใส่สบายแมตช์คู่กับกางเกงยีนส์ตัวโปรด",
    preferences: { style: "streetwear" },
  },
];

interface QuickChipsProps {
  onSelectPrompt: (prompt: string, preferences?: StylistPreferences) => void;
  disabled?: boolean;
}

export function QuickChips({ onSelectPrompt, disabled }: QuickChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-muted-light">
        <Sparkles className="size-3 text-brand" aria-hidden />
        ลองถาม:
      </span>
      {PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelectPrompt(preset.prompt, preset.preferences)}
          className="rounded-[var(--radius-pill)] border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:border-brand hover:bg-lilac-50 hover:text-brand disabled:opacity-50"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
