import { getPrisma } from '@teenstyle/database';

/**
 * Category สำหรับหน้าแรก (STEP 5)
 * ส่วนของ Look ย้ายไปอยู่ที่ [look.service.ts](./look.service.ts) แล้วตั้งแต่ STEP 7
 * (ทั้งหน้าแรกและหน้า /looks ใช้ mapper เดียวกัน ตัวเลขจึงตรงกันเสมอ)
 */

export interface CategoryCardDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  /** จำนวนสินค้าที่ขายอยู่ในหมวดนี้ (รวมหมวดย่อย) */
  productCount: number;
  children: { name: string; slug: string }[];
}

const ACTIVE_PRODUCT = { deletedAt: null, status: 'ACTIVE' } as const;

/**
 * หมวดหมู่ระดับบนสุด พร้อมจำนวนสินค้า
 * นับสินค้าของหมวดตัวเองบวกกับหมวดย่อย เพื่อให้เลขตรงกับที่ผู้ใช้คาด
 */
export async function listRootCategories(): Promise<CategoryCardDto[]> {
  const categories = await getPrisma().category.findMany({
    where: { deletedAt: null, isActive: true, parentId: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      _count: { select: { products: { where: ACTIVE_PRODUCT } } },
      children: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          name: true,
          slug: true,
          _count: { select: { products: { where: ACTIVE_PRODUCT } } },
        },
      },
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    imageUrl: category.imageUrl,
    productCount:
      category._count.products +
      category.children.reduce((sum, child) => sum + child._count.products, 0),
    children: category.children.map((child) => ({ name: child.name, slug: child.slug })),
  }));
}
