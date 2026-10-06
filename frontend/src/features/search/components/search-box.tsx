"use client";

import { Clock, Loader2, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import {
  clearRecentSearches,
  readRecentSearches,
  rememberSearch,
} from "@/features/search/lib/recent-searches";
import { searchHref } from "@/features/search/lib/query";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { fetchSearchSuggestions } from "@/services/search.service";
import type { SearchSuggestions } from "@/types/search";
import { formatBaht } from "@/utils/format";

/** ตัวเลือกหนึ่งรายการในกล่องแนะนำ — ทุกตัวพาไปหน้าที่มีอยู่จริง */
interface Option {
  id: string;
  kind: "query" | "recent" | "product" | "category";
  label: string;
  href: string;
  /** คำที่บันทึกเป็น "ค้นล่าสุด" เมื่อเลือก (สินค้าไม่บันทึก — เป็นการเปิดหน้าสินค้า ไม่ใช่การค้น) */
  remember: string | null;
  product?: SearchSuggestions["products"][number];
}

/**
 * ช่องค้นหา (STEP 45) — combobox ตามแพตเทิร์นของ WAI-ARIA
 *
 * - พิมพ์แล้วหน่วง 250ms ค่อยถามคำแนะนำ · คำขอเก่าที่ยังไม่กลับถูกยกเลิก (ไม่ให้ผลเก่าทับผลใหม่)
 * - คำแนะนำคือ **5 ชิ้นแรกของผลค้นหาจริง** ชุดเดียวกับที่จะเห็นเมื่อกดค้นหา (ไม่ใช่รายการแยก)
 * - ลูกศรขึ้น/ลงเลือก · Enter เปิด · Esc ปิด — ไม่มีเมาส์ก็ใช้ได้ครบ
 * - "ค้นล่าสุด" อยู่ในเครื่องนี้เท่านั้น (ดู lib/recent-searches.ts)
 */
export function SearchBox({
  initialQuery = "",
  autoFocus = false,
}: {
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const listboxId = `${id}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const settled = useDebounce(value.trim(), 250);

  useEffect(() => {
    if (settled === "" || !open) return;

    const controller = new AbortController();

    fetchSearchSuggestions(settled, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSuggestions(result);
      })
      .catch(() => {
        // คำแนะนำโหลดไม่ได้ไม่ใช่ข้อผิดพลาดของการค้นหา — ลูกค้ายังกด Enter ค้นได้ตามปกติ
        if (!controller.signal.aborted) setSuggestions(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [settled, open]);

  const query = value.trim();
  // คำแนะนำของคำที่พิมพ์อยู่ตอนนี้เท่านั้น — ผลของคำก่อนหน้าที่ยังค้างอยู่ห้ามโผล่ปน
  const current = suggestions !== null && suggestions.query === query ? suggestions : null;

  const options: Option[] =
    query === ""
      ? recent.map((item, index) => ({
          id: `${id}-recent-${index}`,
          kind: "recent",
          label: item,
          href: searchHref(item),
          remember: item,
        }))
      : [
          {
            id: `${id}-query`,
            kind: "query",
            label: `ค้นหา “${query}”`,
            href: searchHref(query),
            remember: query,
          },
          ...(current !== null
            ? [
                ...current.products.map((product) => ({
                  id: `${id}-product-${product.id}`,
                  kind: "product" as const,
                  label: product.name,
                  href: `/product/${product.slug}`,
                  remember: null,
                  product,
                })),
                ...current.categories.map((category) => ({
                  id: `${id}-category-${category.slug}`,
                  kind: "category" as const,
                  label: `หมวด ${category.name}`,
                  href: searchHref(category.name),
                  remember: category.name,
                })),
              ]
            : []),
        ];

  const expanded = open && options.length > 0;

  function choose(option: Option) {
    if (option.remember !== null) rememberSearch(option.remember);
    setOpen(false);
    setActive(-1);
    router.push(option.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (options.length === 0 ? -1 : (current + 1) % options.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        options.length === 0 ? -1 : (current - 1 + options.length) % options.length,
      );
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter" && expanded && active >= 0 && options[active] !== undefined) {
      event.preventDefault();
      choose(options[active]);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (query === "") {
      inputRef.current?.focus();
      return;
    }

    rememberSearch(query);
    setOpen(false);
    router.push(searchHref(query));
  }

  return (
    <form role="search" onSubmit={onSubmit} className="relative">
      <label htmlFor={`${id}-input`} className="sr-only">
        ค้นหาสินค้า ลุค และคำถามที่พบบ่อย
      </label>
      <div className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4 shadow-[var(--shadow-soft)] focus-within:border-brand-soft focus-within:ring-2 focus-within:ring-brand/20">
        <Search className="size-5 shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? options[active]?.id : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          enterKeyHint="search"
          value={value}
          maxLength={120}
          placeholder="เช่น เสื้อสีดำ ไม่เกิน 500 บาท"
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
            if (event.target.value.trim() !== "") setLoading(true);
          }}
          onFocus={() => {
            setRecent(readRecentSearches());
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        {loading && query !== "" && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden />
        )}
        <button
          type="submit"
          className="btn-brand flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] px-4 text-sm font-bold transition"
        >
          ค้นหา
        </button>
      </div>

      <p aria-live="polite" className="sr-only">
        {expanded && current !== null ? `มีคำแนะนำ ${options.length - 1} รายการ` : ""}
      </p>

      {expanded && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-float)]">
          {query === "" && (
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-muted">
              <span>ค้นล่าสุด (เก็บไว้ในเครื่องนี้เท่านั้น)</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  clearRecentSearches();
                  setRecent([]);
                }}
                className="flex min-h-11 items-center font-semibold text-brand underline"
              >
                ล้าง
              </button>
            </div>
          )}

          {query !== "" && current !== null && current.understood.length > 0 && (
            <p className="border-b border-line px-4 py-2 text-xs text-muted">
              เข้าใจว่า:{" "}
              {current.understood.map((part) => (
                <span
                  key={part.label}
                  className={cn(
                    "mr-1 font-semibold",
                    part.available ? "text-brand-dark" : "text-warning",
                  )}
                >
                  {part.label}
                  {!part.available && " (ร้านยังไม่มี)"}
                </span>
              ))}
            </p>
          )}

          <ul
            id={listboxId}
            role="listbox"
            aria-label="คำแนะนำการค้นหา"
            className="max-h-[60vh] overflow-y-auto py-1"
          >
            {options.map((option, index) => (
              <li
                key={option.id}
                id={option.id}
                role="option"
                aria-selected={index === active}
                // กดเมาส์แล้วช่องค้นหาเสีย focus → กล่องปิดก่อนคลิกจะถึง จึงกันไว้
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm",
                  index === active ? "bg-lilac-50" : "",
                )}
              >
                {option.kind === "recent" && (
                  <Clock className="size-4 shrink-0 text-muted" aria-hidden />
                )}
                {option.kind === "query" && (
                  <Search className="size-4 shrink-0 text-brand" aria-hidden />
                )}
                {option.kind === "product" && option.product !== undefined && (
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
                    {option.product.image !== null && (
                      <Image
                        src={option.product.image.url}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover"
                      />
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.product !== undefined && (
                  <span className="shrink-0 text-xs font-bold text-brand-dark">
                    {option.product.stockStatus === "OUT_OF_STOCK"
                      ? "สินค้าหมด"
                      : formatBaht(option.product.finalPrice)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
