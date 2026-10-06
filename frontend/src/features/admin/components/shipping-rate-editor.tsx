"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { MONEY_FORMAT_MESSAGE, MONEY_PATTERN } from "@/features/admin/lib/product-form";
import { describeApiError } from "@/lib/api-error-text";
import { updateShippingRate } from "@/services/shipping.service";
import type { ShippingRate, UpdateShippingRateInput } from "@/types/shipping";
import { formatBaht } from "@/utils/format";

import { inputClass } from "./tracking-fields";

/**
 * แก้อัตราค่าส่งหนึ่งวิธี (STEP 44 · `settings:manage`)
 *
 * ⚠️ ตัวเลขผ่าน `MONEY_PATTERN` ก่อนแปลงเสมอ — `Number("abc")` เป็น NaN แล้วกลายเป็น `null`
 *    ตอนส่ง ซึ่ง API อ่านว่า "ล้างค่า" (บั๊กจริงของ STEP 37) · ยอดส่งฟรีที่ว่าง = ยกเลิกโปรส่งฟรี **โดยตั้งใจ**
 * ⚠️ ส่งเฉพาะช่องที่เปลี่ยน — PATCH ไม่เขียนทับทั้งก้อน (กฎ STEP 14 ข้อ 6)
 * ⚠️ ชื่อวิธีแก้ไม่ได้ (ประวัติคำสั่งซื้ออ้างถึง) · จังหวัดเลือกจากรายการที่ server ส่งมาเท่านั้น
 */
export function ShippingRateEditor({
  rate,
  provinces,
  canEdit,
}: {
  rate: ShippingRate;
  provinces: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [description, setDescription] = useState(rate.description);
  const [baseFee, setBaseFee] = useState(String(rate.baseFee));
  const [freeOver, setFreeOver] = useState(
    rate.freeOverSubtotal === null ? "" : String(rate.freeOverSubtotal),
  );
  const [etaText, setEtaText] = useState(rate.etaText);
  const [onlyProvinces, setOnlyProvinces] = useState<string[]>(rate.onlyProvinces ?? []);
  const [isActive, setIsActive] = useState(rate.isActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function buildChanges(): UpdateShippingRateInput | string {
    if (!MONEY_PATTERN.test(baseFee.trim())) return `ค่าส่ง: ${MONEY_FORMAT_MESSAGE}`;
    if (freeOver.trim() !== "" && !MONEY_PATTERN.test(freeOver.trim())) {
      return `ยอดส่งฟรี: ${MONEY_FORMAT_MESSAGE} หรือเว้นว่างถ้าไม่มีโปร`;
    }

    const nextFee = Number(baseFee.trim());
    const nextFree = freeOver.trim() === "" ? null : Number(freeOver.trim());
    const sameProvinces =
      [...onlyProvinces].sort().join("|") === [...(rate.onlyProvinces ?? [])].sort().join("|");

    return {
      ...(description.trim() !== rate.description ? { description: description.trim() } : {}),
      ...(nextFee !== rate.baseFee ? { baseFee: nextFee } : {}),
      ...(nextFree !== rate.freeOverSubtotal ? { freeOverSubtotal: nextFree } : {}),
      ...(etaText.trim() !== rate.etaText ? { etaText: etaText.trim() } : {}),
      ...(sameProvinces ? {} : { onlyProvinces }),
      ...(isActive !== rate.isActive ? { isActive } : {}),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const changes = buildChanges();

    if (typeof changes === "string") {
      setError(changes);
      return;
    }

    if (Object.keys(changes).length === 0) {
      setError("ยังไม่ได้แก้อะไร");
      return;
    }

    setPending(true);

    try {
      await updateShippingRate(rate.code, changes);
      setSaved(true);
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "บันทึกอัตราค่าจัดส่งไม่สำเร็จ"));
    } finally {
      setPending(false);
    }
  }

  const toggleProvince = (province: string) =>
    setOnlyProvinces((current) =>
      current.includes(province)
        ? current.filter((item) => item !== province)
        : [...current, province],
    );

  if (!canEdit) {
    return (
      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        <dt className="text-muted">ค่าส่ง</dt>
        <dd className="font-semibold">
          {rate.baseFee === 0 ? "ไม่มีค่าใช้จ่าย" : formatBaht(rate.baseFee)}
        </dd>
        <dt className="text-muted">ส่งฟรีเมื่อยอดสินค้าครบ</dt>
        <dd className="font-semibold">
          {rate.freeOverSubtotal === null ? "ไม่มีโปรส่งฟรี" : formatBaht(rate.freeOverSubtotal)}
        </dd>
        <dt className="text-muted">ระยะเวลา</dt>
        <dd className="font-semibold">{rate.etaText}</dd>
        <dt className="text-muted">พื้นที่</dt>
        <dd className="font-semibold break-words">
          {rate.onlyProvinces === null ? "ทั่วประเทศ" : rate.onlyProvinces.join(" · ")}
        </dd>
      </dl>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm sm:col-span-2">
          <label htmlFor={`${id}-description`} className="mb-1 block font-semibold">
            คำอธิบาย (ห้ามใส่จำนวนเงิน — ค่าส่งแสดงจากช่องด้านล่าง)
          </label>
          <input
            id={`${id}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={200}
            className={inputClass}
          />
        </div>

        <div className="text-sm">
          <label htmlFor={`${id}-fee`} className="mb-1 block font-semibold">
            ค่าส่ง (บาท)
          </label>
          <input
            id={`${id}-fee`}
            inputMode="decimal"
            value={baseFee}
            onChange={(event) => setBaseFee(event.target.value)}
            className={inputClass}
          />
        </div>

        <div className="text-sm">
          <label htmlFor={`${id}-free`} className="mb-1 block font-semibold">
            ส่งฟรีเมื่อยอดสินค้าครบ (บาท · เว้นว่าง = ไม่มีโปร)
          </label>
          <input
            id={`${id}-free`}
            inputMode="decimal"
            value={freeOver}
            onChange={(event) => setFreeOver(event.target.value)}
            className={inputClass}
          />
        </div>

        <div className="text-sm sm:col-span-2">
          <label htmlFor={`${id}-eta`} className="mb-1 block font-semibold">
            ระยะเวลาที่บอกลูกค้า
          </label>
          <input
            id={`${id}-eta`}
            value={etaText}
            onChange={(event) => setEtaText(event.target.value)}
            maxLength={60}
            className={inputClass}
          />
        </div>

        <details className="rounded-[12px] border border-line p-3 text-sm sm:col-span-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            พื้นที่ให้บริการ:{" "}
            {onlyProvinces.length === 0 ? "ทั่วประเทศ" : `เฉพาะ ${onlyProvinces.length} จังหวัด`}
          </summary>
          <p className="mt-2 text-xs text-muted">
            ไม่ติ๊กเลย = ส่งได้ทั่วประเทศ · ติ๊กแล้ว = ลูกค้าจังหวัดอื่นเลือกวิธีนี้ไม่ได้
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {provinces.map((province) => (
              <label key={province} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyProvinces.includes(province)}
                  onChange={() => toggleProvince(province)}
                  className="size-4 accent-[var(--color-brand)]"
                />
                <span>{province}</span>
              </label>
            ))}
          </div>
        </details>

        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold sm:col-span-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="size-4 accent-[var(--color-brand)]"
          />
          เปิดให้ลูกค้าเลือกวิธีนี้
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="btn-brand flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        บันทึก{rate.name}
      </button>

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4 shrink-0" aria-hidden />
            บันทึกแล้ว — มีผลกับคำสั่งซื้อใหม่ตั้งแต่ตอนนี้
          </p>
        )}
      </div>
    </form>
  );
}
