/**
 * กฎของการแนะนำสินค้า (STEP 46) — ฟังก์ชันบริสุทธิ์ เทสต์ป้อนค่าได้ตรง ๆ
 *
 * **ไม่ใช้ LLM** — คะแนนคำนวณจากสิ่งที่ลูกค้าทำจริงในร้าน (สั่งซื้อ · ถูกใจ · ใส่ตะกร้า · รีวิวดี)
 * และสิ่งที่ลูกค้าคนอื่นซื้อด้วยกันจริง เหตุผล 3 ข้อ:
 *   1. ทุกคำแนะนำต้องอธิบายได้ด้วยสินค้าจริงที่ลูกค้ารู้จัก ("คล้าย “X” ที่คุณถูกใจ") — LLM แต่งเหตุผลได้
 *   2. หน้าแรกเปิดทุกครั้ง = เรียกทุกครั้ง · ค่าใช้จ่ายต่อการเปิดหน้าของ LLM ไม่คุ้มกับการเรียงสินค้าหลักสิบชิ้น
 *   3. ทำงานเหมือนกันทุกครั้งไม่ว่ามี `OPENAI_API_KEY` หรือไม่ (กฎของ Intelligent Fallback ทั้งโปรเจกต์)
 *
 * **กฎที่ห้ามละเมิด**
 * - เหตุผลทุกข้ออ้างสินค้า/หมวดที่มีจริงในสัญญาณของลูกค้าคนนั้น — ไม่มีเหตุผลจริง = ไม่ใส่ในรายการ "สำหรับคุณ"
 * - ไม่แนะนำสิ่งที่ลูกค้าซื้อ ถูกใจ หรือใส่ตะกร้าอยู่แล้ว (เขารู้จักแล้ว) และสิ่งที่รีวิวว่าไม่ชอบ
 * - ผู้เรียกกรองของที่ขายไม่ได้ออกก่อน — การแนะนำของที่ซื้อไม่ได้คือการพาลูกค้าไปเจอทางตัน
 */

export type SignalSource = 'PURCHASE' | 'REVIEW' | 'WISHLIST' | 'CART';

/** น้ำหนักของสิ่งที่ลูกค้าทำ — ซื้อจริงบอกความชอบได้ชัดกว่ากดถูกใจ ซึ่งชัดกว่าแค่ใส่ตะกร้า */
export const SIGNAL_WEIGHT: Readonly<Record<SignalSource, number>> = {
  PURCHASE: 3,
  REVIEW: 2.5,
  WISHLIST: 2,
  CART: 1.5,
};

const SOURCE_PHRASE: Readonly<Record<SignalSource, string>> = {
  PURCHASE: 'ที่คุณสั่งซื้อ',
  REVIEW: 'ที่คุณรีวิวว่าชอบ',
  WISHLIST: 'ที่คุณถูกใจ',
  CART: 'ในตะกร้าของคุณ',
};

/** สินค้าในมุมของการแนะนำ — เฉพาะช่องที่ใช้ให้คะแนน */
export interface RecommendableProduct {
  id: string;
  name: string;
  categoryId: string;
  parentCategoryId: string | null;
  brandId: string | null;
  tags: readonly string[];
  /** ราคาที่ลูกค้าจ่ายจริง (salePrice ?? price) */
  finalPrice: number;
}

export interface Signal {
  source: SignalSource;
  product: RecommendableProduct;
}

/** สินค้าอื่นที่ถูกซื้อในคำสั่งซื้อเดียวกันกับสินค้าที่ลูกค้าสนใจ (คำสั่งซื้อของลูกค้าคนอื่นที่ร้านได้เงินแล้ว) */
export interface CoPurchase {
  productId: string;
  /** จำนวนคำสั่งซื้อที่มีทั้งสองชิ้น */
  orders: number;
  /** สินค้าของลูกค้าที่ทำให้เกิดคู่นี้ — ใช้เขียนเหตุผล */
  anchorName: string;
}

export type RecommendationReason =
  { kind: 'BOUGHT_TOGETHER'; text: string } | { kind: 'SIMILAR'; text: string };

export interface ScoredRecommendation {
  productId: string;
  score: number;
  reason: RecommendationReason;
}

interface Profile {
  categories: Map<string, number>;
  parents: Map<string, number>;
  brands: Map<string, number>;
  tags: Map<string, number>;
  /** ราคาเฉลี่ยถ่วงน้ำหนักของสิ่งที่สนใจ — null = ไม่มีข้อมูลราคา */
  priceCenter: number | null;
}

const add = (map: Map<string, number>, key: string | null, weight: number) => {
  if (key !== null) map.set(key, (map.get(key) ?? 0) + weight);
};

/** สรุปความชอบจากสัญญาณทั้งหมด — สินค้าเดียวกันหลายสัญญาณนับทุกสัญญาณ (ซื้อแล้วยังรีวิวว่าชอบ = ชอบมาก) */
export function buildProfile(signals: readonly Signal[]): Profile {
  const profile: Profile = {
    categories: new Map(),
    parents: new Map(),
    brands: new Map(),
    tags: new Map(),
    priceCenter: null,
  };
  let weightedPrice = 0;
  let totalWeight = 0;

  for (const { source, product } of signals) {
    const weight = SIGNAL_WEIGHT[source];

    add(profile.categories, product.categoryId, weight);
    add(profile.parents, product.parentCategoryId ?? product.categoryId, weight);
    add(profile.brands, product.brandId, weight);
    for (const tag of product.tags) add(profile.tags, tag.toLowerCase(), weight);

    weightedPrice += product.finalPrice * weight;
    totalWeight += weight;
  }

  profile.priceCenter = totalWeight > 0 ? weightedPrice / totalWeight : null;

  return profile;
}

/** ความใกล้ของราคา 0..1 — ราคาเท่ากัน = 1 · ห่างเท่าตัวขึ้นไป = 0 */
export function priceCloseness(price: number, center: number | null): number {
  if (center === null || center <= 0) return 0;

  return Math.max(0, 1 - Math.abs(price - center) / center);
}

/** สัญญาณที่ใกล้กับสินค้านี้ที่สุด — ใช้เขียนเหตุผลว่า "คล้าย “X” …" */
function closestSignal(
  candidate: RecommendableProduct,
  signals: readonly Signal[],
): { signal: Signal; overlap: number } | null {
  let best: { signal: Signal; overlap: number } | null = null;
  const candidateTags = new Set(candidate.tags.map((tag) => tag.toLowerCase()));

  for (const signal of signals) {
    const sharedTags = signal.product.tags.filter((tag) =>
      candidateTags.has(tag.toLowerCase()),
    ).length;
    const sameCategory = signal.product.categoryId === candidate.categoryId ? 2 : 0;
    const sameParent =
      (signal.product.parentCategoryId ?? signal.product.categoryId) ===
      (candidate.parentCategoryId ?? candidate.categoryId)
        ? 1
        : 0;
    // แบรนด์ต้องนับด้วย — ไม่งั้นสินค้าที่ตรงแค่แบรนด์ไม่มีสินค้าอ้างอิง แล้วเหตุผลจะกลายเป็นการเดา
    const sameBrand =
      signal.product.brandId !== null && signal.product.brandId === candidate.brandId ? 1 : 0;
    const overlap =
      (sharedTags + sameCategory + sameParent + sameBrand) * SIGNAL_WEIGHT[signal.source];

    if (overlap > 0 && (best === null || overlap > best.overlap)) best = { signal, overlap };
  }

  return best;
}

/**
 * ให้คะแนนสินค้าที่อาจแนะนำ — คืนเฉพาะชิ้นที่มีเหตุผลจริง เรียงคะแนนมากไปน้อย
 *
 * คะแนน = หมวด + หมวดแม่ + แบรนด์ + tag ที่ตรงกับความชอบ + ความใกล้ของราคา + ซื้อด้วยกัน
 * (ซื้อด้วยกันมีน้ำหนักมากสุด เพราะเป็นพฤติกรรมจริงของคนอื่นที่ซื้อของชิ้นเดียวกัน ไม่ใช่การเดาจากหมวด)
 */
export function scoreCandidates(
  candidates: readonly RecommendableProduct[],
  signals: readonly Signal[],
  coPurchases: readonly CoPurchase[],
  /** ของที่ลูกค้าบอกว่าไม่ชอบ (รีวิว 1–2 ดาว) — ห้ามแนะนำกลับ (ผู้เรียกตัดออกจาก `signals` แล้ว) */
  excluded: ReadonlySet<string> = new Set(),
): ScoredRecommendation[] {
  if (signals.length === 0) return [];

  const profile = buildProfile(signals);
  const known = new Set([...signals.map((signal) => signal.product.id), ...excluded]);
  const together = new Map(coPurchases.map((row) => [row.productId, row]));
  const results: ScoredRecommendation[] = [];

  for (const candidate of candidates) {
    if (known.has(candidate.id)) continue;

    const co = together.get(candidate.id);
    const content =
      (profile.categories.get(candidate.categoryId) ?? 0) * 1 +
      (profile.parents.get(candidate.parentCategoryId ?? candidate.categoryId) ?? 0) * 0.5 +
      (candidate.brandId === null ? 0 : (profile.brands.get(candidate.brandId) ?? 0) * 0.6) +
      candidate.tags.reduce(
        (sum, tag) => sum + (profile.tags.get(tag.toLowerCase()) ?? 0) * 0.4,
        0,
      );
    const coScore = co === undefined ? 0 : 6 * Math.log2(1 + co.orders);

    // ไม่มีอะไรเชื่อมกับสิ่งที่ลูกค้าทำเลย = ไม่ใช่คำแนะนำ "สำหรับคุณ" (ราคาใกล้กันอย่างเดียวไม่นับ)
    if (content === 0 && coScore === 0) continue;

    const score =
      content + coScore + priceCloseness(candidate.finalPrice, profile.priceCenter) * 0.5;
    const closest = closestSignal(candidate, signals);

    /**
     * เหตุผลต้องอ้างสินค้าจริงเสมอ — คะแนนจากเนื้อหา > 0 แปลว่ามีสัญญาณที่ตรงหมวด/แบรนด์/tag อย่างน้อยหนึ่งชิ้น
     * (`closestSignal` นับทุกอย่างที่ `content` นับ) จึงไม่มีกรณีที่ต้องเดาเหตุผล
     */
    const reason: RecommendationReason =
      co !== undefined && (coScore >= content || closest === null)
        ? { kind: 'BOUGHT_TOGETHER', text: `ลูกค้าที่ซื้อ “${co.anchorName}” ซื้อชิ้นนี้ด้วย` }
        : {
            kind: 'SIMILAR',
            text: `คล้าย “${closest!.signal.product.name}” ${SOURCE_PHRASE[closest!.signal.source]}`,
          };

    results.push({ productId: candidate.id, score, reason });
  }

  return results.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
}

/* ───────────────────────── สินค้าคล้ายกัน (หน้าสินค้า) ───────────────────────── */

/**
 * สินค้าคล้ายกับชิ้นที่กำลังดู — หมวด/หมวดแม่ · tag ที่ตรงกัน · ราคาใกล้กัน
 * ต้องมีอย่างน้อยหมวดแม่เดียวกันหรือ tag ร่วม ไม่งั้นไม่นับว่า "คล้าย"
 */
export function scoreSimilar(
  base: RecommendableProduct,
  candidates: readonly RecommendableProduct[],
): { productId: string; score: number; text: string }[] {
  const baseTags = new Set(base.tags.map((tag) => tag.toLowerCase()));
  const baseParent = base.parentCategoryId ?? base.categoryId;

  return candidates
    .filter((candidate) => candidate.id !== base.id)
    .map((candidate) => {
      const shared = candidate.tags.filter((tag) => baseTags.has(tag.toLowerCase()));
      const sameCategory = candidate.categoryId === base.categoryId;
      const sameParent = (candidate.parentCategoryId ?? candidate.categoryId) === baseParent;
      const score =
        (sameCategory ? 3 : sameParent ? 1.5 : 0) +
        shared.length +
        priceCloseness(candidate.finalPrice, base.finalPrice);

      const text =
        shared.length > 0
          ? `${sameParent ? `หมวดเดียวกัน · ` : ''}สไตล์ร่วม: ${shared.slice(0, 3).join(', ')}`
          : 'หมวดเดียวกัน';

      return { productId: candidate.id, score, text, relevant: sameParent || shared.length > 0 };
    })
    .filter((row) => row.relevant)
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId))
    .map(({ productId, score, text }) => ({ productId, score, text }));
}
