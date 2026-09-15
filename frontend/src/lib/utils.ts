import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * รวม class name แบบที่ class ของ Tailwind ที่ชนกันจะถูกแทนที่อย่างถูกต้อง
 * (เช่น cn("px-2", "px-4") => "px-4")
 *
 * เป็นฟังก์ชันที่ shadcn/ui ทุกคอมโพเนนต์เรียกใช้
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
