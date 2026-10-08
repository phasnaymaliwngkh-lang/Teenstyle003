-- ============================================================================
-- STEP 49: store settings become data the store edits (table "StoreSetting").
-- Three knowledge-base articles stored those values as literal text — the AI quotes the
-- articles as store policy, so the first edit at /admin/settings would make them promise
-- something the system no longer does (the same problem STEP 44 fixed for shipping fees).
--
-- The values become tokens the backend renders on every read (models/policy-tokens.ts):
--   {{store.contact}}        contact channels that exist
--   {{store.agent_hours}}    staff hours
--   {{returns.window_days}}  return window in days
--   {{payment.cod_max}}      COD limit
--   {{payment.methods}}      payment methods with their live status — the seeded text froze
--                            the status at seed time (Stripe stayed "not available" forever,
--                            even after it was configured)
--
-- Only the exact phrases that carry these values are replaced, inside these three articles.
-- An article an admin rewrote keeps its own wording; a phrase that is no longer there is
-- simply not replaced. Each replacement renders to the same text it replaces today.
-- ============================================================================

-- ── return window ──────────────────────────────────────────────────────────
UPDATE "KnowledgeArticle"
   SET "summary" = replace("summary", 'ได้ภายใน 7 วันหลังได้รับพัสดุ', 'ได้ภายใน {{returns.window_days}} วันหลังได้รับพัสดุ'),
       "updatedAt" = now()
 WHERE "slug" = 'return-and-exchange-policy'
   AND position('ได้ภายใน 7 วันหลังได้รับพัสดุ' IN "summary") > 0;

UPDATE "KnowledgeArticle"
   SET "content" = replace("content", 'ได้ภายใน **7 วัน** นับจากวันที่ระบบขนส่ง', 'ได้ภายใน **{{returns.window_days}} วัน** นับจากวันที่ระบบขนส่ง'),
       "updatedAt" = now()
 WHERE "slug" = 'return-and-exchange-policy'
   AND position('ได้ภายใน **7 วัน** นับจากวันที่ระบบขนส่ง' IN "content") > 0;

UPDATE "KnowledgeFaq" f
   SET "answer" = replace(f."answer", 'ได้ภายใน 7 วันหลังได้รับสินค้า', 'ได้ภายใน {{returns.window_days}} วันหลังได้รับสินค้า')
  FROM "KnowledgeArticle" a
 WHERE f."articleId" = a."id"
   AND a."slug" = 'return-and-exchange-policy'
   AND position('ได้ภายใน 7 วันหลังได้รับสินค้า' IN f."answer") > 0;

-- ── COD limit + payment methods ────────────────────────────────────────────
UPDATE "KnowledgeArticle"
   SET "summary" = replace("summary", 'รับยอดไม่เกิน 5,000 บาท', 'รับยอดไม่เกิน {{payment.cod_max}} บาท'),
       "updatedAt" = now()
 WHERE "slug" = 'payment-methods-cod-guide'
   AND position('รับยอดไม่เกิน 5,000 บาท' IN "summary") > 0;

UPDATE "KnowledgeArticle"
   SET "content" = replace("content", 'ยอดรวมไม่เกิน **5,000 บาท**', 'ยอดรวมไม่เกิน **{{payment.cod_max}} บาท**'),
       "updatedAt" = now()
 WHERE "slug" = 'payment-methods-cod-guide'
   AND position('ยอดรวมไม่เกิน **5,000 บาท**' IN "content") > 0;

-- the two method lines + their status lines, whatever status was frozen in at seed time
UPDATE "KnowledgeArticle"
   SET "content" = regexp_replace(
         "content",
         '- \*\*บัตรเครดิต/เดบิต หรือ PromptPay\*\*[^\n]*\n  สถานะ: [^\n]*\n- \*\*เก็บเงินปลายทาง \(COD\)\*\*[^\n]*\n  สถานะ: [^\n]*',
         '{{payment.methods}}'
       ),
       "updatedAt" = now()
 WHERE "slug" = 'payment-methods-cod-guide'
   AND "content" ~ '- \*\*บัตรเครดิต/เดบิต หรือ PromptPay\*\*[^\n]*\n  สถานะ: [^\n]*\n- \*\*เก็บเงินปลายทาง \(COD\)\*\*[^\n]*\n  สถานะ: [^\n]*';

UPDATE "KnowledgeFaq" f
   SET "answer" = replace(f."answer", 'ยอดรวมไม่เกิน 5,000 บาท', 'ยอดรวมไม่เกิน {{payment.cod_max}} บาท')
  FROM "KnowledgeArticle" a
 WHERE f."articleId" = a."id"
   AND a."slug" = 'payment-methods-cod-guide'
   AND position('ยอดรวมไม่เกิน 5,000 บาท' IN f."answer") > 0;

-- ── contact channels + staff hours ─────────────────────────────────────────
UPDATE "KnowledgeArticle"
   SET "content" = replace(
         "content",
         '- **แชตกับฝ่ายบริการลูกค้าบนเว็บ:** /customer-service — AI ตอบทันที และส่งต่อให้เจ้าหน้าที่คนจริงได้ทุกเมื่อ
- **อีเมล:** hello@teenstyle.ai',
         '{{store.contact}}'
       ),
       "updatedAt" = now()
 WHERE "slug" = 'contact-support-and-office-hours'
   AND position('- **แชตกับฝ่ายบริการลูกค้าบนเว็บ:** /customer-service — AI ตอบทันที และส่งต่อให้เจ้าหน้าที่คนจริงได้ทุกเมื่อ
- **อีเมล:** hello@teenstyle.ai' IN "content") > 0;

UPDATE "KnowledgeArticle"
   SET "content" = replace("content", '**เจ้าหน้าที่คนจริง (Live Agent):** วันจันทร์ – เสาร์ เวลา 09:00 – 18:00 น.', '**เจ้าหน้าที่คนจริง (Live Agent):** {{store.agent_hours}}'),
       "updatedAt" = now()
 WHERE "slug" = 'contact-support-and-office-hours'
   AND position('**เจ้าหน้าที่คนจริง (Live Agent):** วันจันทร์ – เสาร์ เวลา 09:00 – 18:00 น.' IN "content") > 0;
