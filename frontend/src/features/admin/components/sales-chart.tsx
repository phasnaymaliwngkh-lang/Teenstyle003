import type { Granularity, SalesPoint } from "@/types/analytics";

/**
 * กราฟแท่งยอดขาย (STEP 26)
 *
 * วาดเป็น SVG ตรง ๆ ไม่ใช้ไลบรารีกราฟ เพราะ
 *   1. เป็น Server Component → ไม่ต้องส่ง JS ไปให้เบราว์เซอร์เลย
 *   2. ไม่เพิ่ม dependency ให้ต้องดูแลต่อ
 *
 * ⚠️ **ทุกช่วงเวลาในกราฟมาจาก backend ที่เติมจุด 0 มาให้แล้ว** (`fillSeries`)
 *    ห้ามกรองจุดที่ยอดเป็น 0 ทิ้งที่นี่ ไม่งั้นกราฟจะดูเหมือนขายได้ต่อเนื่อง
 *    ทั้งที่ความจริงคือวันนั้นไม่มีใครซื้อเลย
 *
 * ⚠️ **ไม่มียอดขายเลย = บอกตรง ๆ ว่าไม่มี** ไม่ใช่วาดแท่งเตี้ย ๆ ให้ดูเหมือนมีข้อมูล
 *    (กฎเดียวกับ "ยังไม่มีรีวิว ห้ามโชว์ 0.0 ดาว" ของ STEP 23 ข้อ 4)
 *
 * Accessibility: SVG เป็นภาพประกอบ (`aria-hidden`) และมี **ตารางข้อมูลจริง** คู่กัน
 * ที่ซ่อนด้วย `sr-only` — screen reader อ่านตัวเลขได้ครบ ไม่ใช่ได้ยินแค่ "รูปภาพ"
 */

const CHART_WIDTH = 960;
const CHART_HEIGHT = 260;
const PADDING = { top: 16, right: 8, bottom: 28, left: 56 };

const baht = (value: number) => `฿${value.toLocaleString("th-TH")}`;

/** ป้ายแกนนอนให้อ่านง่ายตามความละเอียดที่เลือก */
function bucketLabel(bucket: string, granularity: Granularity): string {
  const at = new Date(`${bucket}T00:00:00.000Z`);

  if (granularity === "month") {
    return at.toLocaleDateString("th-TH", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  }

  const short = at.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return granularity === "week" ? `สัปดาห์ ${short}` : short;
}

/** ขั้นแกนตั้งที่อ่านง่าย (1 / 2 / 5 × 10^n) */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;

  return step * magnitude;
}

export function SalesChart({
  series,
  granularity,
}: {
  series: SalesPoint[];
  granularity: Granularity;
}) {
  const maxRevenue = Math.max(...series.map((point) => point.revenue), 0);

  if (series.length === 0 || maxRevenue === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
        <p className="font-extrabold">ยังไม่มียอดขายในช่วงนี้</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          ไม่มีคำสั่งซื้อที่ได้รับเงินในช่วงเวลาที่เลือก — ลองขยายช่วงวันที่ดู
        </p>
      </div>
    );
  }

  const top = niceCeiling(maxRevenue);
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const slot = plotWidth / series.length;
  const barWidth = Math.max(2, Math.min(48, slot * 0.62));

  // แสดงป้ายแกนนอนไม่เกิน 12 อัน ไม่งั้นทับกันจนอ่านไม่ออกบนจอแคบ
  const labelEvery = Math.ceil(series.length / 12);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: Math.round(top * ratio),
  }));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-[260px] w-full"
        preserveAspectRatio="none"
        aria-hidden
        focusable="false"
      >
        {ticks.map((tick) => {
          const y = PADDING.top + plotHeight * (1 - tick.ratio);

          return (
            <g key={tick.ratio}>
              <line
                x1={PADDING.left}
                x2={CHART_WIDTH - PADDING.right}
                y1={y}
                y2={y}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--color-muted)"
              >
                {tick.value.toLocaleString("th-TH")}
              </text>
            </g>
          );
        })}

        {series.map((point, index) => {
          const height = top === 0 ? 0 : (point.revenue / top) * plotHeight;
          const x = PADDING.left + slot * index + (slot - barWidth) / 2;
          const y = PADDING.top + plotHeight - height;

          return (
            <g key={point.bucket}>
              {point.revenue > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={3}
                  fill="var(--color-brand)"
                />
              )}
              {index % labelEvery === 0 && (
                <text
                  x={PADDING.left + slot * index + slot / 2}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-muted)"
                >
                  {bucketLabel(point.bucket, granularity)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* ข้อมูลจริงสำหรับ screen reader — กราฟด้านบนเป็นภาพประกอบเท่านั้น */}
      <figcaption className="sr-only">
        <table>
          <caption>ยอดขายและจำนวนคำสั่งซื้อแยกตามช่วงเวลา</caption>
          <thead>
            <tr>
              <th scope="col">ช่วงเวลา</th>
              <th scope="col">ยอดขาย</th>
              <th scope="col">จำนวนคำสั่งซื้อ</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.bucket}>
                <th scope="row">{bucketLabel(point.bucket, granularity)}</th>
                <td>{baht(point.revenue)}</td>
                <td>{point.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
