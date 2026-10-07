"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { megabytes, precheckImageFile } from "@/lib/image-upload";
import { cn } from "@/lib/utils";
import {
  removeProductImage,
  reorderProductImages,
  updateProductImageAlt,
  uploadProductImage,
} from "@/services/admin.service";
import type { AdminProductImage, ProductFormOptions } from "@/types/admin";

type UploadRules = ProductFormOptions["imageUpload"];

interface QueuedFile {
  key: string;
  file: File;
  previewUrl: string;
  alt: string;
  /** ตรวจไม่ผ่านตั้งแต่ฝั่งเบราว์เซอร์ หรืออัปโหลดแล้ว server ปฏิเสธ */
  error: string | null;
  uploading: boolean;
}

/**
 * รูปสินค้า (STEP 47) — อัปโหลด · แก้คำอธิบาย · เรียงลำดับ · ถอดรูป ทีละรูป บันทึกทันที
 *
 * ⚠️ **รูปแรกคือรูปหลัก** (การ์ดสินค้า ตะกร้า คำสั่งซื้อใช้รูปนี้) — "ตั้งเป็นรูปหลัก" = ย้ายขึ้นลำดับแรก
 * ⚠️ ทุกการเปลี่ยนส่งลำดับ/ข้อมูลไปให้ server แล้ว **ใช้ผลที่ server ตอบกลับ** เป็นความจริง
 *    ไม่สลับลำดับในหน้าจอเองก่อน (ถ้ามีคนแก้พร้อมกัน server ตอบ 409 ให้โหลดใหม่)
 * ⚠️ ถอดรูปไม่ลบไฟล์ทันที — รูปอาจอยู่ในประวัติคำสั่งซื้อ หน้าเว็บบอกเรื่องนี้ตรง ๆ
 */
export function ProductImageManager({
  productId,
  productName,
  isActive,
  initialImages,
  rules,
}: {
  productId: string;
  productName: string;
  /** สินค้าเปิดขายอยู่ — ถอดรูปสุดท้ายไม่ได้ */
  isActive: boolean;
  initialImages: AdminProductImage[];
  rules: UploadRules;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [, startTransition] = useTransition();

  const [images, setImages] = useState(initialImages);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // จำคิวล่าสุดไว้ให้ตอนออกจากหน้า — เขียน ref ใน effect ไม่ใช่ระหว่าง render
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // คืนหน่วยความจำของภาพตัวอย่างที่ยังค้างอยู่ตอนออกจากหน้า
  useEffect(
    () => () => {
      for (const item of queueRef.current) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  const busy = busyId !== null || queue.some((item) => item.uploading);
  const slotsLeft = rules.maxImages - images.length;
  const readyCount = queue.filter((item) => precheckImageFile(item.file, rules) === null).length;

  /** ใช้ผลจาก server แล้วให้ส่วนอื่นของหน้า (สถานะ จำนวนรูป) โหลดใหม่ตาม */
  function applyServerImages(next: AdminProductImage[], message: string) {
    setImages(next);
    setNotice(message);
    startTransition(() => router.refresh());
  }

  async function run(id: string, action: () => Promise<AdminProductImage[]>, message: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      applyServerImages(await action(), message);
    } catch (caught) {
      setError(describeApiError(caught, "บันทึกรูปไม่สำเร็จ"));
    } finally {
      setBusyId(null);
      setConfirmRemoveId(null);
    }
  }

  function onPickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // ล้างค่าเพื่อให้เลือกไฟล์เดิมซ้ำได้ (เบราว์เซอร์ไม่ยิง change ถ้าค่าเท่าเดิม)
    event.target.value = "";
    if (files.length === 0) return;

    const room = Math.max(0, rules.maxImages - images.length - queue.length);
    const accepted = files.slice(0, room);

    setNotice(null);
    setError(
      accepted.length < files.length
        ? `สินค้าหนึ่งชิ้นมีรูปได้ไม่เกิน ${rules.maxImages} รูป — รับไว้ ${accepted.length} จาก ${files.length} ไฟล์`
        : null,
    );

    setQueue([
      ...queue,
      ...accepted.map((file, index) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${queue.length + index}`,
        file,
        previewUrl: URL.createObjectURL(file),
        alt: `${productName} รูปที่ ${images.length + queue.length + index + 1}`,
        error: precheckImageFile(file, rules),
        uploading: false,
      })),
    ]);
  }

  function dropFromQueue(key: string) {
    setQueue((current) => {
      const item = current.find((entry) => entry.key === key);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((entry) => entry.key !== key);
    });
  }

  function patchQueue(key: string, patch: Partial<QueuedFile>) {
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  /** อัปโหลดทีละไฟล์ — ไฟล์ที่ไม่ผ่านค้างไว้พร้อมเหตุผล ไฟล์ที่ผ่านหายจากคิว */
  async function uploadQueue() {
    setError(null);
    setNotice(null);

    let uploaded = 0;

    // ภาพรวมของคิว ณ ตอนกด — ระหว่างอัปโหลดปุ่มทั้งหมดถูกปิด คิวจึงไม่เปลี่ยนจากทางอื่น
    for (const item of [...queue]) {
      // ข้ามเฉพาะไฟล์ที่ผิดตั้งแต่ในเบราว์เซอร์ — ไฟล์ที่ server เคยปฏิเสธลองใหม่ได้ด้วยการกดอีกครั้ง
      if (precheckImageFile(item.file, rules) !== null) continue;

      if (item.alt.trim().length < 2) {
        patchQueue(item.key, { error: "กรุณาใส่คำอธิบายรูปอย่างน้อย 2 ตัวอักษร" });
        continue;
      }

      patchQueue(item.key, { uploading: true });

      try {
        const next = await uploadProductImage(productId, item.file, item.alt.trim());
        setImages(next);
        dropFromQueue(item.key);
        uploaded += 1;
      } catch (caught) {
        patchQueue(item.key, {
          uploading: false,
          error: describeApiError(caught, "อัปโหลดรูปนี้ไม่สำเร็จ"),
        });
      }
    }

    if (uploaded > 0) {
      setNotice(`อัปโหลดแล้ว ${uploaded} รูป`);
      startTransition(() => router.refresh());
    }
  }

  function moveTo(id: string, targetIndex: number) {
    const order = images.map((image) => image.id).filter((imageId) => imageId !== id);
    order.splice(targetIndex, 0, id);

    void run(
      id,
      () => reorderProductImages(productId, order),
      targetIndex === 0 ? "ตั้งเป็นรูปหลักแล้ว" : "เรียงรูปใหม่แล้ว",
    );
  }

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className="rounded-[var(--radius-card)] border border-line bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${fieldId}-title`} className="text-lg">
            รูปสินค้า ({images.length}/{rules.maxImages})
          </h2>
          <p className="mt-1 text-sm text-muted">
            <strong className="text-ink-soft">รูปแรกคือรูปหลัก</strong> ที่ใช้บนการ์ดสินค้า ตะกร้า
            และคำสั่งซื้อ · {rules.acceptedText} ไม่เกิน {megabytes(rules.maxBytes)} ·
            ด้านสั้นอย่างน้อย {rules.minShortEdge} px
          </p>
          <p className="mt-1 text-xs text-muted">
            ระบบแปลงทุกรูปเป็น WebP และลบข้อมูลที่ติดมากับไฟล์ (ตำแหน่ง GPS รุ่นกล้อง เวลาถ่าย)
            ก่อนเก็บ
          </p>
        </div>

        <label
          className={cn(
            "flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-brand hover:border-brand-soft hover:bg-lilac-50",
            (slotsLeft - queue.length <= 0 || busy) && "pointer-events-none opacity-50",
          )}
        >
          <ImagePlus className="size-4" aria-hidden />
          เลือกรูป
          <input
            type="file"
            accept={rules.acceptedTypes.join(",")}
            multiple
            onChange={onPickFiles}
            disabled={slotsLeft - queue.length <= 0 || busy}
            className="sr-only"
          />
        </label>
      </div>

      {/* ─── รอการอัปโหลด ─── */}
      {queue.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-dashed border-brand-soft bg-lilac-50 p-3">
          <p className="text-sm font-bold">รอการอัปโหลด ({queue.length})</p>

          <ul className="mt-2 space-y-2">
            {queue.map((item, index) => (
              <li key={item.key} className="flex flex-wrap gap-3 rounded-[10px] bg-white p-2">
                <div className="relative size-16 shrink-0 overflow-hidden rounded-[8px] bg-lilac-50">
                  <Image src={item.previewUrl} alt="" fill sizes="64px" className="object-cover" />
                </div>

                <div className="min-w-0 flex-1">
                  <label htmlFor={`${fieldId}-q-${index}`} className="text-xs font-semibold">
                    คำอธิบายรูป (alt) ของไฟล์ {item.file.name}
                  </label>
                  <input
                    id={`${fieldId}-q-${index}`}
                    value={item.alt}
                    maxLength={200}
                    disabled={item.uploading}
                    onChange={(event) =>
                      patchQueue(item.key, {
                        alt: event.target.value,
                        // แก้คำอธิบายแล้วลองใหม่ได้ — ล้างเฉพาะ error ของ alt ไม่ใช่ของไฟล์
                        ...(item.error?.startsWith("กรุณาใส่คำอธิบาย") ? { error: null } : {}),
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-[10px] border border-line px-3 text-sm outline-none focus:border-brand-soft"
                  />
                  {item.error !== null && (
                    <p role="alert" className="mt-1 text-xs font-semibold text-danger">
                      {item.error}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dropFromQueue(item.key)}
                  disabled={item.uploading}
                  aria-label={`เอาไฟล์ ${item.file.name} ออกจากรายการรออัปโหลด`}
                  className="grid size-11 shrink-0 place-items-center rounded-full border border-line transition hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  {item.uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <X className="size-4" aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void uploadQueue()}
            disabled={busy || readyCount === 0}
            className="btn-brand mt-3 flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold disabled:opacity-50"
          >
            {queue.some((item) => item.uploading) ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            อัปโหลด {readyCount} รูป
          </button>
        </div>
      )}

      {/* ─── รูปที่มีอยู่ ─── */}
      {images.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-line bg-lilac-50 p-4 text-sm text-muted">
          ยังไม่มีรูป — สินค้าที่ไม่มีรูปบันทึกเป็นฉบับร่างได้ แต่เปิดขายไม่ได้
        </p>
      ) : (
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {images.map((image, index) => {
            const draft = altDrafts[image.id] ?? image.alt;
            const altChanged = draft.trim() !== image.alt;
            const isLastOnActive = isActive && images.length === 1;

            return (
              <li key={image.id} className="min-w-0 rounded-[12px] border border-line p-3">
                <div className="flex gap-3">
                  <div className="relative size-24 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
                    <Image src={image.url} alt="" fill sizes="96px" className="object-cover" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1 text-sm font-bold">
                      รูปที่ {index + 1}
                      {index === 0 && (
                        <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-brand px-2 py-0.5 text-xs text-white">
                          <Star className="size-3" aria-hidden />
                          รูปหลัก
                        </span>
                      )}
                      {!image.uploaded && (
                        <span className="rounded-[var(--radius-pill)] border border-line px-2 py-0.5 text-xs font-normal text-muted">
                          ลิงก์ภายนอก (ข้อมูลตัวอย่าง)
                        </span>
                      )}
                    </p>

                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(
                          image.id,
                          () => updateProductImageAlt(productId, image.id, draft.trim()),
                          "บันทึกคำอธิบายรูปแล้ว",
                        );
                      }}
                      className="mt-2"
                    >
                      <label
                        htmlFor={`${fieldId}-alt-${image.id}`}
                        className="text-xs font-semibold"
                      >
                        คำอธิบายรูปที่ {index + 1} (alt)
                      </label>
                      <div className="mt-1 flex gap-2">
                        <input
                          id={`${fieldId}-alt-${image.id}`}
                          value={draft}
                          maxLength={200}
                          disabled={busy}
                          onChange={(event) =>
                            setAltDrafts((current) => ({
                              ...current,
                              [image.id]: event.target.value,
                            }))
                          }
                          className="min-h-11 w-full min-w-0 rounded-[10px] border border-line px-3 text-sm outline-none focus:border-brand-soft"
                        />
                        {altChanged && (
                          <button
                            type="submit"
                            disabled={busy || draft.trim().length < 2}
                            aria-label={`บันทึกคำอธิบายรูปที่ ${index + 1}`}
                            className="grid size-11 shrink-0 place-items-center rounded-full border border-brand-soft text-brand-dark transition hover:bg-lilac-50 disabled:opacity-50"
                          >
                            <Check className="size-4" aria-hidden />
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => moveTo(image.id, 0)}
                      disabled={busy}
                      className="flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-line px-3 text-xs font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
                    >
                      <Star className="size-4" aria-hidden />
                      ตั้งเป็นรูปหลัก
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => moveTo(image.id, index - 1)}
                    disabled={busy || index === 0}
                    aria-label={`เลื่อนรูปที่ ${index + 1} ไปก่อนหน้า`}
                    className="grid size-11 place-items-center rounded-full border border-line transition hover:border-brand-soft disabled:opacity-40"
                  >
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTo(image.id, index + 1)}
                    disabled={busy || index === images.length - 1}
                    aria-label={`เลื่อนรูปที่ ${index + 1} ไปถัดไป`}
                    className="grid size-11 place-items-center rounded-full border border-line transition hover:border-brand-soft disabled:opacity-40"
                  >
                    <ArrowRight className="size-4" aria-hidden />
                  </button>

                  {confirmRemoveId === image.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            image.id,
                            () => removeProductImage(productId, image.id),
                            "ถอดรูปแล้ว",
                          )
                        }
                        disabled={busy}
                        className="flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-danger bg-danger px-3 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {busyId === image.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="size-4" aria-hidden />
                        )}
                        ยืนยันถอดรูปที่ {index + 1}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(null)}
                        disabled={busy}
                        className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-3 text-xs font-semibold"
                      >
                        ไม่ถอด
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(image.id)}
                      disabled={busy || isLastOnActive}
                      title={
                        isLastOnActive ? "สินค้าที่เปิดขายต้องมีรูปอย่างน้อย 1 รูป" : undefined
                      }
                      aria-label={
                        isLastOnActive
                          ? `ถอดรูปที่ ${index + 1} ไม่ได้ — สินค้าที่เปิดขายต้องมีรูปอย่างน้อย 1 รูป`
                          : `ถอดรูปที่ ${index + 1}`
                      }
                      className="grid size-11 place-items-center rounded-full border border-line transition hover:border-danger hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-3 text-xs text-muted">
        ถอดรูปแล้วไฟล์ยังไม่ถูกลบทันที — รูปอาจอยู่ในประวัติคำสั่งซื้อของลูกค้า
        ไฟล์ที่ไม่มีที่ไหนใช้แล้วลบได้ที่หน้าคลังรูป
      </p>

      <div aria-live="polite" className="mt-3 space-y-2">
        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-danger/30 bg-danger/5 p-3 text-sm font-semibold text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4 shrink-0" aria-hidden />
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
