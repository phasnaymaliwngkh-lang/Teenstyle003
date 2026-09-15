import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

/**
 * Layout ของหน้าร้าน (STEP 4)
 *
 * ใช้ route group `(storefront)` ซึ่งไม่มีผลกับ URL — แค่แยกว่าหน้าไหนได้ navbar/footer
 * หน้า /admin อยู่นอกกลุ่มนี้ จึงมี layout ของตัวเอง (STEP 13 จะทำ sidebar)
 * หน้า /signin ก็อยู่นอกกลุ่ม เพราะเป็นหน้าโฟกัสเดียว มีโลโก้ของตัวเองอยู่แล้ว
 */
export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Navbar />
      <div className="flex flex-1 flex-col">{children}</div>
      <Footer />
    </>
  );
}
