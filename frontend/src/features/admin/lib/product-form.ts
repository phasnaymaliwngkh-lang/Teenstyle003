import { z } from "zod";

import type {
  AdminProduct,
  CreateProductInput,
  ProductStatus,
  UpdateProductInput,
} from "@/types/admin";

/**
 * กฎของฟอร์มสินค้า (STEP 14) — **เพื่อ UX เท่านั้น**
 *
 * ⚠️ backend ตรวจทุกกฎนี้ซ้ำอีกครั้งด้วย
 *    `backend/src/validators/product-admin.validator.ts` + service
 *    ฝั่ง client แค่ช่วยให้แอดมินเห็น error ก่อนกดส่ง — **ไม่ใช่การป้องกัน**
 *
 * ฟิลด์ตัวเลขเก็บเป็น string ในฟอร์ม (ช่องว่าง = "ไม่กำหนด") แล้วแปลงเป็นตัวเลข
 * ตอนประกอบ payload — เพื่อแยก "0" ออกจาก "ไม่กรอก" ให้ชัด
 */

export const PRODUCT_STATUSES: { value: ProductStatus; label: string; hint: string }[] = [
  { value: "DRAFT", label: "ฉบับร่าง", hint: "ยังไม่แสดงในหน้าร้าน" },
  { value: "ACTIVE", label: "เปิดขาย", hint: "ต้องมีรูปและตัวเลือกที่เปิดใช้งาน" },
  { value: "ARCHIVED", label: "เก็บเข้าคลัง", hint: "ซ่อนจากหน้าร้านแต่เก็บข้อมูลไว้" },
];

const MONEY_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;
const INTEGER_PATTERN = /^\d{1,6}$/;

const moneyText = z.string().trim().regex(MONEY_PATTERN, "กรอกเป็นตัวเลข เช่น 590 หรือ 590.50");

const optionalMoneyText = z.union([z.literal(""), moneyText]);
const optionalIntegerText = z.union([
  z.literal(""),
  z.string().trim().regex(INTEGER_PATTERN, "กรอกเป็นจำนวนเต็ม"),
]);

export interface ProductImageFormValue {
  url: string;
  alt: string;
  isMain: boolean;
}

export interface ProductVariantFormValue {
  sku: string;
  colorSlug: string;
  sizeCode: string;
  price: string;
  salePrice: string;
  initialStock: string;
  isActive: boolean;
}

export interface ProductFormValues {
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  price: string;
  salePrice: string;
  categorySlug: string;
  brandSlug: string;
  status: ProductStatus;
  minimumStock: string;
  /** คั่นด้วยจุลภาค */
  tags: string;
  images: ProductImageFormValue[];
  /** ใช้เฉพาะโหมดสร้าง — โหมดแก้ไขจัดการตัวเลือกแยกหน้าละรายการ */
  variants: ProductVariantFormValue[];
}

export interface ProductFormRules {
  /** โฮสต์รูปที่ระบบอนุญาต — มาจาก backend ไม่ฮาร์ดโค้ด */
  allowedImageHosts: string[];
  mode: "create" | "edit";
  /** โหมดแก้ไข: มีตัวเลือกที่เปิดใช้งานอยู่แล้วไหม (ใช้ตรวจก่อนเปิดขาย) */
  hasActiveVariant?: boolean;
}

function isAllowedImageUrl(value: string, allowedHosts: string[]): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

export function createProductFormSchema(rules: ProductFormRules) {
  const imageSchema = z.object({
    url: z
      .string()
      .trim()
      .min(1, "กรุณาใส่ลิงก์รูป")
      .refine((value) => isAllowedImageUrl(value, rules.allowedImageHosts), {
        message: `รูปต้องเป็น https และมาจาก: ${rules.allowedImageHosts.join(", ")}`,
      }),
    alt: z.string().trim().min(2, "ใส่คำอธิบายรูปเพื่อการเข้าถึง").max(200),
    isMain: z.boolean(),
  });

  const variantSchema = z.object({
    sku: z
      .string()
      .trim()
      .min(3, "SKU สั้นเกินไป")
      .max(60)
      .regex(/^[A-Z0-9-]+$/, "SKU ใช้ได้เฉพาะตัวพิมพ์ใหญ่ ตัวเลข และขีดกลาง"),
    colorSlug: z.string(),
    sizeCode: z.string(),
    price: optionalMoneyText,
    salePrice: optionalMoneyText,
    initialStock: optionalIntegerText,
    isActive: z.boolean(),
  });

  return z
    .object({
      name: z.string().trim().min(2, "ชื่อสินค้าสั้นเกินไป").max(200),
      slug: z
        .string()
        .trim()
        .min(2, "slug สั้นเกินไป")
        .max(200)
        .regex(/^[a-z0-9-]+$/, "slug ใช้ได้เฉพาะตัวอักษรเล็ก ตัวเลข และขีดกลาง"),
      sku: z
        .string()
        .trim()
        .min(3, "SKU สั้นเกินไป")
        .max(60)
        .regex(/^[A-Z0-9-]+$/, "SKU ใช้ได้เฉพาะตัวพิมพ์ใหญ่ ตัวเลข และขีดกลาง"),
      description: z
        .string()
        .trim()
        .min(10, "คำอธิบายสั้นเกินไป (อย่างน้อย 10 ตัวอักษร)")
        .max(5000),
      shortDescription: z.string().trim().max(300),
      price: moneyText,
      salePrice: optionalMoneyText,
      categorySlug: z.string().trim().min(1, "กรุณาเลือกหมวดหมู่"),
      brandSlug: z.string(),
      status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
      minimumStock: optionalIntegerText,
      tags: z.string().max(400),
      images: z.array(imageSchema).max(10),
      variants: z.array(variantSchema).max(50),
    })
    .superRefine((value, ctx) => {
      const price = Number(value.price);

      if (value.salePrice !== "" && Number(value.salePrice) >= price) {
        ctx.addIssue({
          code: "custom",
          path: ["salePrice"],
          message: "ราคาลดต้องน้อยกว่าราคาปกติ",
        });
      }

      if (value.images.filter((image) => image.isMain).length > 1) {
        ctx.addIssue({ code: "custom", path: ["images"], message: "ตั้งรูปหลักได้เพียงรูปเดียว" });
      }

      if (rules.mode === "create") {
        if (value.variants.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["variants"],
            message: "ต้องมีตัวเลือกสินค้าอย่างน้อย 1 รายการ",
          });
        }

        const skus = value.variants.map((variant) => variant.sku.trim());
        if (new Set(skus).size !== skus.length) {
          ctx.addIssue({ code: "custom", path: ["variants"], message: "SKU ของตัวเลือกซ้ำกัน" });
        }

        const pairs = value.variants.map(
          (variant) => `${variant.colorSlug || "-"}|${variant.sizeCode || "-"}`,
        );
        if (new Set(pairs).size !== pairs.length) {
          ctx.addIssue({
            code: "custom",
            path: ["variants"],
            message: "มีตัวเลือกที่สี/ไซซ์ซ้ำกัน",
          });
        }
      }

      value.variants.forEach((variant, index) => {
        // กฎเดียวกับ backend: ราคาลดของตัวเลือกมีผลเฉพาะเมื่อกำหนดราคาของตัวเลือกด้วย
        if (variant.salePrice !== "" && variant.price === "") {
          ctx.addIssue({
            code: "custom",
            path: ["variants", index, "salePrice"],
            message: "ต้องกำหนดราคาของตัวเลือกนี้ด้วย ไม่งั้นส่วนลดจะไม่มีผล",
          });
        }

        if (
          variant.salePrice !== "" &&
          variant.price !== "" &&
          Number(variant.salePrice) >= Number(variant.price)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["variants", index, "salePrice"],
            message: "ราคาลดต้องน้อยกว่าราคาปกติ",
          });
        }
      });

      // เปิดขายได้ต้องมีของให้ขายจริง (backend บังคับเหมือนกัน)
      if (value.status === "ACTIVE") {
        if (value.images.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["status"],
            message: "ต้องมีรูปสินค้าอย่างน้อย 1 รูปก่อนเปิดขาย",
          });
        }

        const hasActive =
          rules.mode === "create"
            ? value.variants.some((variant) => variant.isActive)
            : rules.hasActiveVariant === true;

        if (!hasActive) {
          ctx.addIssue({
            code: "custom",
            path: ["status"],
            message: "ต้องมีตัวเลือกสินค้าที่เปิดใช้งานอย่างน้อย 1 รายการก่อนเปิดขาย",
          });
        }
      }
    });
}

/**
 * ยามตอนคอมไพล์: schema ต้องให้ค่าตรงกับ `ProductFormValues` เป๊ะทั้งสองทาง
 * ถ้าเพิ่มฟิลด์ในฟอร์มแล้วลืมใส่ใน schema (หรือกลับกัน) บรรทัดนี้จะ error ทันที
 */
type Assert<T extends true> = T;
type SchemaValues = z.infer<ReturnType<typeof createProductFormSchema>>;

export type SchemaMatchesFormValues = Assert<
  SchemaValues extends ProductFormValues
    ? ProductFormValues extends SchemaValues
      ? true
      : false
    : false
>;

function parseMoney(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function toCreateInput(values: ProductFormValues): CreateProductInput {
  const salePrice = parseMoney(values.salePrice);
  const shortDescription = values.shortDescription.trim();
  const brandSlug = values.brandSlug.trim();

  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    sku: values.sku.trim(),
    description: values.description.trim(),
    ...(shortDescription !== "" ? { shortDescription } : {}),
    price: Number(values.price),
    ...(salePrice !== undefined ? { salePrice } : {}),
    categorySlug: values.categorySlug,
    ...(brandSlug !== "" ? { brandSlug } : {}),
    status: values.status,
    minimumStock: values.minimumStock.trim() === "" ? 5 : Number(values.minimumStock),
    tags: parseTags(values.tags),
    images: values.images.map((image, index) => ({
      url: image.url.trim(),
      alt: image.alt.trim(),
      isMain: image.isMain,
      sortOrder: index,
    })),
    variants: values.variants.map((variant) => {
      const price = parseMoney(variant.price);
      const variantSale = parseMoney(variant.salePrice);
      const color = variant.colorSlug.trim();
      const size = variant.sizeCode.trim();

      return {
        sku: variant.sku.trim(),
        ...(price !== undefined ? { price } : {}),
        ...(variantSale !== undefined ? { salePrice: variantSale } : {}),
        ...(color !== "" ? { colorSlug: color } : {}),
        ...(size !== "" ? { sizeCode: size } : {}),
        initialStock: variant.initialStock.trim() === "" ? 0 : Number(variant.initialStock),
        isActive: variant.isActive,
      };
    }),
  };
}

/** ค่าเริ่มต้นของฟอร์มตอนแก้ไข — ต้องสะท้อนค่าจริงในฐานข้อมูล */
export function toFormValues(product: AdminProduct): ProductFormValues {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    shortDescription: product.shortDescription ?? "",
    price: String(product.price),
    salePrice: product.salePrice === null ? "" : String(product.salePrice),
    categorySlug: product.category.slug,
    brandSlug: product.brand?.slug ?? "",
    status: product.status,
    minimumStock: String(product.minimumStock),
    tags: product.tags.join(", "),
    images: product.images.map((image) => ({
      url: image.url,
      alt: image.alt,
      isMain: image.isMain,
    })),
    variants: [],
  };
}

/**
 * ส่งเฉพาะฟิลด์ที่เปลี่ยนจริง
 *
 * สำคัญ: ถ้าส่งทุกฟิลด์ไปหมด การกดบันทึกโดยไม่แก้อะไรจะกลายเป็นการเขียนทับ
 * และ log การแก้ไขจะเต็มไปด้วยรายการที่ไม่มีอะไรเปลี่ยน
 */
export function toUpdateInput(
  values: ProductFormValues,
  product: AdminProduct,
): UpdateProductInput {
  const input: UpdateProductInput = {};
  const trimmed = {
    name: values.name.trim(),
    slug: values.slug.trim(),
    sku: values.sku.trim(),
    description: values.description.trim(),
    shortDescription: values.shortDescription.trim(),
    brandSlug: values.brandSlug.trim(),
  };

  if (trimmed.name !== product.name) input.name = trimmed.name;
  if (trimmed.slug !== product.slug) input.slug = trimmed.slug;
  if (trimmed.sku !== product.sku) input.sku = trimmed.sku;
  if (trimmed.description !== product.description) input.description = trimmed.description;
  if (trimmed.shortDescription !== (product.shortDescription ?? "")) {
    input.shortDescription = trimmed.shortDescription;
  }

  const price = Number(values.price);
  if (price !== product.price) input.price = price;

  const salePrice = parseMoney(values.salePrice);
  if ((salePrice ?? null) !== product.salePrice) {
    // null = เลิกโปรโมชัน
    input.salePrice = salePrice ?? null;
  }

  if (values.categorySlug !== product.category.slug) input.categorySlug = values.categorySlug;
  if (trimmed.brandSlug !== (product.brand?.slug ?? "")) input.brandSlug = trimmed.brandSlug;
  if (values.status !== product.status) input.status = values.status;

  const minimumStock = values.minimumStock.trim() === "" ? 0 : Number(values.minimumStock);
  if (minimumStock !== product.minimumStock) input.minimumStock = minimumStock;

  const tags = parseTags(values.tags);
  if (tags.join("|") !== product.tags.join("|")) input.tags = tags;

  const images = values.images.map((image, index) => ({
    url: image.url.trim(),
    alt: image.alt.trim(),
    isMain: image.isMain,
    sortOrder: index,
  }));
  const currentImages = product.images.map((image, index) => ({
    url: image.url,
    alt: image.alt,
    isMain: image.isMain,
    sortOrder: index,
  }));

  if (JSON.stringify(images) !== JSON.stringify(currentImages)) input.images = images;

  return input;
}

export function emptyVariantRow(): ProductVariantFormValue {
  return {
    sku: "",
    colorSlug: "",
    sizeCode: "",
    price: "",
    salePrice: "",
    initialStock: "",
    isActive: true,
  };
}

export function emptyFormValues(): ProductFormValues {
  return {
    name: "",
    slug: "",
    sku: "",
    description: "",
    shortDescription: "",
    price: "",
    salePrice: "",
    categorySlug: "",
    brandSlug: "",
    status: "DRAFT",
    minimumStock: "5",
    tags: "",
    images: [],
    variants: [emptyVariantRow()],
  };
}
