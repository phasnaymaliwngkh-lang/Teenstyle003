-- ============================================================================
-- STEP 43: the returns policy article told customers the website could not take
-- refund requests ("ระบบยังไม่เปิดให้ยื่นคำขอคืนเงินด้วยตัวเอง…"). That stops being true
-- in this step, and the AI Customer Service quotes this article as store policy.
--
-- Articles live in the database (STEP 21) and are seeded only once, so changing the
-- source text does not reach existing databases. Replace exactly the old paragraph,
-- and only where it is still there: if an admin already rewrote the article, the
-- WHERE clause does not match and their text is left alone.
-- ============================================================================

UPDATE "KnowledgeArticle"
   SET "content" = replace("content", $old$- **การคืนเงิน** ดำเนินการโดยเจ้าหน้าที่เป็นรายกรณี — แจ้งเรื่องในแชตฝ่ายบริการลูกค้าเพื่อให้เจ้าหน้าที่ตรวจสอบและแจ้งกำหนดเวลาคืนเงินตามช่องทางที่คุณใช้ชำระ
  (ระบบยังไม่เปิดให้ยื่นคำขอคืนเงินด้วยตัวเองบนหน้าเว็บ จึงต้องผ่านเจ้าหน้าที่ทุกกรณี)$old$, $new$- **การคืนเงิน**: ยื่นคำขอได้เองที่หน้ารายละเอียดคำสั่งซื้อ (ปุ่ม "ขอคืนสินค้า") — ร้านตรวจคำขอ แจ้งให้ส่งสินค้ากลับ แล้วคืนเงินตามช่องทางที่คุณชำระ (ชำระออนไลน์คืนเข้าช่องทางเดิม · เก็บเงินปลายทางคืนด้วยการโอนเข้าบัญชี โดยเจ้าหน้าที่ติดต่อขอเลขบัญชีผ่านแชตฝ่ายบริการลูกค้า)
- ยอดเงินคืนคิดตามสัดส่วนของเงินที่จ่ายจริงสำหรับชิ้นที่คืน และคืนค่าจัดส่งให้เมื่อคืนครบทุกชิ้น · แต้มที่ใช้หรือได้จากคำสั่งซื้อนั้นปรับตามสัดส่วนเดียวกัน$new$),
       "updatedAt" = now()
 WHERE "slug" = 'return-and-exchange-policy'
   AND position($old$- **การคืนเงิน** ดำเนินการโดยเจ้าหน้าที่เป็นรายกรณี — แจ้งเรื่องในแชตฝ่ายบริการลูกค้าเพื่อให้เจ้าหน้าที่ตรวจสอบและแจ้งกำหนดเวลาคืนเงินตามช่องทางที่คุณใช้ชำระ
  (ระบบยังไม่เปิดให้ยื่นคำขอคืนเงินด้วยตัวเองบนหน้าเว็บ จึงต้องผ่านเจ้าหน้าที่ทุกกรณี)$old$ in "content") > 0;
