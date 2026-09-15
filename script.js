/* ==========================================================================
   TEENSTYLE AI — script.js
   1. PRODUCTS  2. Helpers  3. Store (localStorage)  4. Render (shop/cart/wish)
   5. Cart & Wishlist  6. Search  7. AI Chat  8. Nav  9. Smooth scroll
   10. Reveal on scroll  11. Overlay manager  12. FAQ  13. Image fallback
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function () {

  /* ===== 1. PRODUCTS — single source of truth ===== */
  const IMG = 'https://images.unsplash.com/';
  const q = '?w=700&q=80&auto=format&fit=crop';

  const PRODUCTS = [
    { id:'p01', name:'เสื้อยืด Oversize คอตตอน', en:'Oversize Cotton Tee', price:390, old:590,
      styles:['street','minimal'], occasions:['เรียน','ชิล'], tones:['mono','earth'],
      colors:['#111114','#FFFFFF','#B7A99A'], sizes:['S','M','L','XL'], rating:4.9, reviews:214,
      badge:'sale', img:IMG+'photo-1521572163474-6864f9cf17ab'+q },

    { id:'p02', name:'เสื้อครอปนิตติ้งแขนสั้น', en:'Crop Knit Top', price:490, old:0,
      styles:['korean','cute'], occasions:['เดท','เรียน'], tones:['pastel','mono'],
      colors:['#F5D0E0','#FFFFFF','#A78BFA'], sizes:['S','M','L'], rating:4.8, reviews:168,
      badge:'new', img:IMG+'photo-1515886657613-9f3515b0c78f'+q },

    { id:'p03', name:'ยีนส์ทรงกระบอกใหญ่', en:'Baggy Jeans', price:890, old:1190,
      styles:['street','sporty'], occasions:['เรียน','ชิล'], tones:['mono','earth'],
      colors:['#6B7C93','#2B3445','#111114'], sizes:['S','M','L','XL'], rating:4.9, reviews:302,
      badge:'sale', img:IMG+'photo-1542272604-787c3835535d'+q },

    { id:'p04', name:'กระโปรงจีบสั้นทรงเอ', en:'Pleated Mini Skirt', price:590, old:0,
      styles:['korean','cute'], occasions:['เดท','เรียน'], tones:['pastel','mono'],
      colors:['#111114','#E8D9F0','#FFFFFF'], sizes:['S','M','L'], rating:4.7, reviews:141,
      badge:'', img:IMG+'photo-1529139574466-a303027c1d8b'+q },

    { id:'p05', name:'ฮู้ดดี้ Oversize ผ้าสำลี', en:'Oversize Hoodie', price:790, old:990,
      styles:['street','sporty'], occasions:['เรียน','ชิล'], tones:['mono','earth','pastel'],
      colors:['#A78BFA','#111114','#D6D3CB'], sizes:['M','L','XL'], rating:4.9, reviews:276,
      badge:'sale', img:IMG+'photo-1556821840-3a63f95609a7'+q },

    { id:'p06', name:'เสื้อเมชซ้อนสไตล์ Y2K', en:'Y2K Mesh Top', price:450, old:0,
      styles:['y2k','street'], occasions:['ปาร์ตี้','เดท'], tones:['bright','mono'],
      colors:['#111114','#C084FC','#FB7185'], sizes:['S','M','L'], rating:4.6, reviews:97,
      badge:'new', img:IMG+'photo-1496747611176-843222e1e57c'+q },

    { id:'p07', name:'กางเกงคาร์โก้ขายาว', en:'Cargo Pants', price:790, old:0,
      styles:['street','sporty'],occasions:['เรียน','ชิล'], tones:['earth','mono'],
      colors:['#7C6A52','#111114','#5B6650'], sizes:['S','M','L','XL'], rating:4.8, reviews:189,
      badge:'', img:IMG+'photo-1552374196-c4e7ffc6e126'+q },

    { id:'p08', name:'เดรสสายเดี่ยวผ้าซาติน', en:'Satin Slip Dress', price:990, old:1290,
      styles:['y2k','minimal'], occasions:['เดท','ปาร์ตี้'], tones:['mono','pastel','bright'],
      colors:['#111114','#C2A2D6','#E7D3C1'], sizes:['S','M','L'], rating:4.9, reviews:233,
      badge:'sale', img:IMG+'photo-1539109136881-3be0616acf4b'+q },

    { id:'p09', name:'แจ็คเก็ตวาร์ซิตี้ปักอักษร', en:'Varsity Jacket', price:1290, old:0,
      styles:['street','sporty'], occasions:['เรียน','ชิล'], tones:['mono','bright'],
      colors:['#111114','#3B4C8A','#F2E8D5'], sizes:['M','L','XL'], rating:4.8, reviews:156,
      badge:'new', img:IMG+'photo-1492707892479-7bc8d5a4ee93'+q },

    { id:'p10', name:'เดรสเชิ้ตมินิมอลสีพื้น', en:'Minimal Shirt Dress', price:890, old:0,
      styles:['minimal','korean'], occasions:['เรียน','เดท','ชิล'], tones:['mono','earth'],
      colors:['#FFFFFF','#111114','#C9BFAE'], sizes:['S','M','L'], rating:4.7, reviews:128,
      badge:'', img:IMG+'photo-1534528741775-53994a69daeb'+q },

    { id:'p11', name:'หมวกบักเก็ตผ้าแคนวาส', en:'Canvas Bucket Hat', price:290, old:390,
      styles:['street','cute'], occasions:['ชิล','เรียน'], tones:['earth','pastel','bright'],
      colors:['#111114','#A78BFA','#C9BFAE'], sizes:['Free'], rating:4.7, reviews:203,
      badge:'sale', img:IMG+'photo-1517841905240-472988babdf9'+q },

    { id:'p12', name:'สนีกเกอร์ชังกี้พื้นหนา', en:'Chunky Sneakers', price:1490, old:1890,
      styles:['y2k','sporty','street'], occasions:['เรียน','เดท','ปาร์ตี้','ชิล'], tones:['mono','bright'],
      colors:['#FFFFFF','#111114','#E8D9F0'], sizes:['36','37','38','39','40'], rating:4.9, reviews:341,
      badge:'sale', img:IMG+'photo-1483985988355-763728e1935b'+q }
  ];

  const STYLE_LABEL = { street:'Street', minimal:'Minimal', y2k:'Y2K', korean:'Korean', sporty:'Sporty', cute:'Cute' };
  const FREE_SHIP = 690;
  const SHIP_FEE = 50;

  /* ===== 2. HELPERS ===== */
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const byId = id => PRODUCTS.filter(p => p.id === id)[0];
  const baht = n => Number(n).toLocaleString('th-TH') + '.-';
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const stars = r => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));

  /* ===== 3. STORE (localStorage + in-memory fallback) ===== */
  const memory = {};
  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : (memory[key] !== undefined ? memory[key] : fallback);
    } catch (e) {
      return memory[key] !== undefined ? memory[key] : fallback;
    }
  }
  function writeStore(key, value) {
    memory[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: เก็บใน memory */ }
  }

  const KEY_CART = 'ts_cart';
  const KEY_WISH = 'ts_wishlist';

  const getCart = () => (readStore(KEY_CART, []) || []).filter(i => i && byId(i.id));
  const setCart = c => { writeStore(KEY_CART, c); renderCart(); syncBadges(); };
  const getWish = () => (readStore(KEY_WISH, []) || []).filter(id => byId(id));
  const setWish = w => { writeStore(KEY_WISH, w); renderWishlist(); syncBadges(); syncWishUI(); };

  /* ===== 4. RENDER ===== */
  function productCard(p) {
    const off = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
    const badge = p.badge === 'sale' ? '<span class="product__badge product__badge--sale">SALE -' + off + '%</span>'
                : p.badge === 'new'  ? '<span class="product__badge product__badge--new">NEW</span>' : '';
    return '' +
      '<article class="product reveal" data-id="' + p.id + '">' +
        '<div class="product__img">' +
          '<img src="' + p.img + '" alt="' + esc(p.name) + '" width="700" height="875" loading="lazy" data-fallback="' + esc(p.en) + '">' +
          badge +
          '<button class="product__wish" type="button" data-wish="' + p.id + '" aria-pressed="false" aria-label="เพิ่ม ' + esc(p.name) + ' ใน Wishlist">' +
            '<svg class="icon"><use href="#i-heart"></use></svg>' +
          '</button>' +
        '</div>' +
        '<div class="product__body">' +
          '<span class="product__style">' + p.styles.map(s => STYLE_LABEL[s]).join(' · ') + '</span>' +
          '<h3 class="product__name">' + esc(p.name) + '</h3>' +
          '<div class="product__rate"><span class="stars" aria-hidden="true">' + stars(p.rating) + '</span>' +
            '<small>' + p.rating.toFixed(1) + ' (' + p.reviews + ' รีวิว)</small></div>' +
          '<div class="product__colors" aria-label="สีที่มี">' +
            p.colors.map(c => '<i style="background:' + c + '"></i>').join('') + '</div>' +
          '<div class="product__sizes" aria-label="ไซซ์ที่มี">' +
            p.sizes.map(s => '<span>' + s + '</span>').join('') + '</div>' +
          '<div class="product__buy">' +
            '<div class="product__price"><b>' + baht(p.price) + '</b>' +
              (p.old ? '<s>' + baht(p.old) + '</s>' : '') + '</div>' +
            '<button class="btn btn--primary btn--sm" type="button" data-add="' + p.id + '">เพิ่มลงตะกร้า</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /** แถวสินค้าแบบกะทัดรัด ใช้ร่วมกันใน search / cart / wishlist / คำแนะนำของ AI */
  function rowItem(p, opts) {
    opts = opts || {};
    const side = opts.side || ('<span class="row-item__price">' + baht(p.price) + '</span>');
    const act = opts.actions === undefined
      ? '<div class="row-item__act"><button class="mini-btn" type="button" data-add="' + p.id + '">+ ตะกร้า</button></div>'
      : opts.actions;
    return '' +
      '<div class="row-item" data-id="' + p.id + '">' +
        '<div class="row-item__img"><img src="' + p.img + '" alt="' + esc(p.name) + '" loading="lazy" data-fallback="' + esc(p.en) + '"></div>' +
        '<div class="row-item__info">' +
          '<strong>' + esc(p.name) + '</strong>' +
          '<small>' + p.styles.map(s => STYLE_LABEL[s]).join(' · ') + (opts.sub ? ' · ' + opts.sub : '') + '</small>' +
          act +
        '</div>' +
        '<div class="row-item__side">' + side + '</div>' +
      '</div>';
  }

  const grid = $('#productGrid');
  const gridEmpty = $('#productEmpty');
  let currentFilter = 'all';

  function renderProducts(filter) {
    currentFilter = filter || 'all';
    const list = currentFilter === 'all'
      ? PRODUCTS
      : PRODUCTS.filter(p => p.styles.indexOf(currentFilter) > -1);
    grid.innerHTML = list.map(productCard).join('');
    gridEmpty.hidden = list.length > 0;
    syncWishUI();
    $$('.reveal', grid).forEach(el => el.classList.add('is-visible'));
  }

  /* ===== 5. CART & WISHLIST ===== */
  function syncBadges() {
    const cartQty = getCart().reduce((s, i) => s + i.qty, 0);
    const wishQty = getWish().length;
    [['cart', cartQty], ['wishlist', wishQty]].forEach(pair => {
      const el = $('[data-badge="' + pair[0] + '"]');
      if (!el) return;
      el.textContent = pair[1];
      el.hidden = pair[1] === 0;
    });
    $('#cartCount').textContent = '(' + cartQty + ')';
    $('#wishCount').textContent = '(' + wishQty + ')';
  }

  function syncWishUI() {
    const wish = getWish();
    $$('[data-wish]').forEach(btn => {
      btn.setAttribute('aria-pressed', wish.indexOf(btn.dataset.wish) > -1 ? 'true' : 'false');
    });
  }

  function addToCart(id) {
    const p = byId(id);
    if (!p) return;
    const cart = getCart();
    const found = cart.filter(i => i.id === id)[0];
    if (found) found.qty += 1; else cart.push({ id: id, qty: 1 });
    setCart(cart);
    toast('เพิ่ม ' + p.name + ' ลงตะกร้าแล้ว 🛍️');
  }

  function changeQty(id, diff) {
    let cart = getCart();
    cart.forEach(i => { if (i.id === id) i.qty += diff; });
    cart = cart.filter(i => i.qty > 0);
    setCart(cart);
  }

  function removeFromCart(id) {
    setCart(getCart().filter(i => i.id !== id));
    toast('ลบสินค้าออกจากตะกร้าแล้ว');
  }

  function toggleWish(id) {
    const p = byId(id);
    if (!p) return;
    const wish = getWish();
    const at = wish.indexOf(id);
    if (at > -1) { wish.splice(at, 1); toast('เอา ' + p.name + ' ออกจาก Wishlist'); }
    else { wish.push(id); toast('เก็บ ' + p.name + ' ไว้ใน Wishlist 💖'); }
    setWish(wish);
  }

  function renderCart() {
    const cart = getCart();
    const body = $('#cartBody');
    const foot = $('#cartFoot');

    if (!cart.length) {
      body.innerHTML = '<div class="panel-empty"><span>🛍️</span><strong>ตะกร้ายังว่างอยู่</strong>' +
        '<p>เลือกสินค้าที่ถูกใจ หรือให้ AI Stylist ช่วยแนะนำก็ได้</p>' +
        '<button class="btn btn--primary" type="button" data-ai="stylist">ให้ AI แนะนำให้</button></div>';
      foot.hidden = true;
      return;
    }

    body.innerHTML = cart.map(item => {
      const p = byId(item.id);
      return rowItem(p, {
        sub: 'ไซซ์ ' + p.sizes[0],
        actions: '<div class="row-item__act"><div class="qty">' +
                   '<button type="button" data-qty="-1" data-target="' + p.id + '" aria-label="ลดจำนวน">−</button>' +
                   '<span>' + item.qty + '</span>' +
                   '<button type="button" data-qty="1" data-target="' + p.id + '" aria-label="เพิ่มจำนวน">+</button>' +
                 '</div></div>',
        side: '<span class="row-item__price">' + baht(p.price * item.qty) + '</span>' +
              '<button class="mini-btn mini-btn--icon" type="button" data-del="' + p.id + '" aria-label="ลบ ' + esc(p.name) + '">' +
                '<svg class="icon icon--xs"><use href="#i-trash"></use></svg></button>'
      });
    }).join('');

    const qty = cart.reduce((s, i) => s + i.qty, 0);
    const subtotal = cart.reduce((s, i) => s + byId(i.id).price * i.qty, 0);
    const ship = subtotal >= FREE_SHIP ? 0 : SHIP_FEE;

    $('#cartSubtotal').textContent = baht(subtotal);
    $('#cartShip').textContent = ship === 0 ? 'ฟรี' : baht(ship);
    $('#cartTotal').textContent = baht(subtotal + ship);
    $('#cartHint').textContent = ship === 0
      ? (qty >= 2 ? 'ได้ส่งฟรีแล้ว 🎉 ใส่โค้ด TEEN15 ที่หน้าชำระเงินเพื่อลดเพิ่ม 15%' : 'คุณได้รับส่งฟรีแล้ว 🎉')
      : 'ซื้อเพิ่ม ' + baht(FREE_SHIP - subtotal) + ' รับส่งฟรีทันที';
    foot.hidden = false;
  }

  function renderWishlist() {
    const wish = getWish();
    const body = $('#wishBody');
    if (!wish.length) {
      body.innerHTML = '<div class="panel-empty"><span>💖</span><strong>ยังไม่มีของที่ถูกใจ</strong>' +
        '<p>กดรูปหัวใจบนสินค้าที่ชอบ เพื่อเก็บไว้ดูทีหลัง</p>' +
        '<a class="btn btn--primary" href="#shop">ไปเลือกสินค้า</a></div>';
      return;
    }
    body.innerHTML = '<div class="search-results">' + wish.map(id => {
      const p = byId(id);
      return rowItem(p, {
        actions: '<div class="row-item__act">' +
          '<button class="mini-btn" type="button" data-add="' + p.id + '">+ ตะกร้า</button>' +
          '<button class="mini-btn" type="button" data-wish="' + p.id + '" aria-pressed="true">เอาออก</button></div>'
      });
    }).join('') + '</div>';
  }

  /* ===== 6. SEARCH ===== */
  const searchInput = $('#searchInput');
  const searchResults = $('#searchResults');

  function searchProducts(text) {
    const key = text.trim().toLowerCase();
    if (!key) return [];
    return PRODUCTS.filter(p => {
      const hay = [p.name, p.en, p.styles.map(s => STYLE_LABEL[s]).join(' '), p.styles.join(' '),
        p.occasions.join(' '), p.sizes.join(' ')].join(' ').toLowerCase();
      return hay.indexOf(key) > -1;
    });
  }

  function renderSearch(text) {
    if (!text.trim()) {
      searchResults.innerHTML = '<p class="empty">พิมพ์เพื่อค้นหาสินค้า เช่น <b>oversize</b>, <b>ยีนส์</b>, <b>เดท</b></p>';
      return;
    }
    const found = searchProducts(text);
    if (!found.length) {
      searchResults.innerHTML = '<p class="empty">ไม่พบสินค้าที่ตรงกับ “' + esc(text) + '”<br>ลองคำอื่น หรือให้ AI Stylist ช่วยเลือกก็ได้นะ 💜</p>';
      return;
    }
    searchResults.innerHTML = '<p class="empty" style="padding:0 0 8px;text-align:left">พบ ' + found.length + ' รายการ</p>' +
      found.map(p => rowItem(p)).join('');
    syncWishUI();
  }

  let searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    const v = searchInput.value;
    searchTimer = setTimeout(function () { renderSearch(v); }, 180);
  });
  $$('[data-q]').forEach(btn => btn.addEventListener('click', function () {
    searchInput.value = btn.dataset.q;
    renderSearch(btn.dataset.q);
    searchInput.focus();
  }));

  /* ===== 7. AI CHAT (mock — front-end เท่านั้น) ===== */
  const chatLog = $('#chatLog');
  const chatQuick = $('#chatQuick');
  const chatForm = $('#chatForm');
  const chatInput = $('#chatInput');

  const FLOW = [
    { key:'style', q:'อยากได้ลุคสไตล์ไหนดีคะ? 💜', options:[
      { label:'Street', value:'street' }, { label:'Minimal', value:'minimal' }, { label:'Y2K', value:'y2k' },
      { label:'Korean', value:'korean' }, { label:'Sporty', value:'sporty' }, { label:'Cute', value:'cute' }] },
    { key:'tone', q:'ชอบโทนสีแบบไหนมากกว่ากัน?', options:[
      { label:'ขาว–ดำ', value:'mono' }, { label:'พาสเทล', value:'pastel' },
      { label:'โทนเอิร์ธ', value:'earth' }, { label:'สีสด', value:'bright' }] },
    { key:'occasion', q:'ใส่ไปโอกาสอะไรคะ?', options:[
      { label:'ไปเรียน', value:'เรียน' }, { label:'ไปเดท', value:'เดท' },
      { label:'ปาร์ตี้', value:'ปาร์ตี้' }, { label:'ชิล ๆ', value:'ชิล' }] },
    { key:'budget', q:'งบต่อชิ้นประมาณเท่าไหร่ดี?', options:[
      { label:'ไม่เกิน 500.-', value:'low' }, { label:'500–1,000.-', value:'mid' }, { label:'1,000.- ขึ้นไป', value:'high' }] }
  ];

  /* ลำดับใน SUPPORT_KB สำคัญ — answerSupport() ใช้รายการแรกที่ตรง
     จึงต้องวางคำถามเฉพาะทางไว้ก่อน และวางคำทักทาย (คำสั้น เช่น "hi") ไว้ท้ายสุด */
  const SUPPORT_KB = [
    { k:['ส่ง','จัดส่ง','ขนส่ง','กี่วัน','ems','shipping','ค่าส่ง'], a:'การจัดส่ง 🚚<br>• กรุงเทพฯ และปริมณฑล 1–2 วันทำการ<br>• ต่างจังหวัด 2–4 วันทำการ<br>• <b>ส่งฟรีเมื่อสั่งครบ ' + FREE_SHIP + ' บาท</b> (ไม่ครบคิดค่าส่ง ' + SHIP_FEE + ' บาท)<br>ระบบจะแจ้งเลขพัสดุอัตโนมัติทันทีที่ส่งของค่ะ' },
    { k:['คืน','เปลี่ยน','refund','return','ไม่พอดี'], a:'การคืน/เปลี่ยนสินค้า 📦<br>ส่งคำขอได้ภายใน <b>7 วัน</b> นับจากวันที่ได้รับสินค้า โดยสินค้าต้องอยู่ในสภาพสมบูรณ์ ยังไม่ผ่านการใช้งาน และมีป้ายครบ ตามเงื่อนไขและนโยบายของร้านค่ะ' },
    { k:['ชำระ','จ่าย','โอน','พร้อมเพย์','บัตร','ปลายทาง','payment','cod','เครดิต'], a:'ช่องทางชำระเงิน 💳<br>• โอนผ่านธนาคาร / พร้อมเพย์<br>• บัตรเครดิต–เดบิต<br>• เก็บเงินปลายทาง (COD)<br>ระบบจะยืนยันคำสั่งซื้อทันทีที่ชำระเงินสำเร็จค่ะ' },
    { k:['ไซซ์','ไซส์','size','ขนาด','อก','เอว','สูง'], a:'เรื่องไซซ์ 📏<br>ทุกสินค้ามีตารางไซซ์ (รอบอก/เอว/ความยาว) ให้เทียบก่อนสั่งซื้อ และเลือกไซซ์กับสีที่มีอยู่ในระบบได้เลยค่ะ ถ้าอยู่ระหว่างสองไซซ์ แนะนำไซซ์ใหญ่ขึ้นหนึ่งขั้นสำหรับทรง Oversize ค่ะ' },
    { k:['ติดตาม','สถานะ','พัสดุ','tracking','ออเดอร์','คำสั่งซื้อ','ของถึงไหน'], a:'ติดตามคำสั่งซื้อ 🔎<br>ดูสถานะได้ทุกขั้นตอน: ยืนยันคำสั่งซื้อ → ชำระเงินสำเร็จ → แพ็กสินค้า → กำลังจัดส่ง → จัดส่งสำเร็จ<br>แจ้งเลขออเดอร์ (เช่น #TS-24081) ไว้ได้เลยค่ะ' },
    { k:['โปร','ส่วนลด','คูปอง','โค้ด','แต้ม','สมาชิก','point','loyalty'], a:'โปรโมชั่นและสมาชิก 🎁<br>• โค้ด <b>TEEN15</b> ลดเพิ่ม 15% เมื่อซื้อครบ 2 ชิ้น<br>• สมัครสมาชิกใหม่รับ 100 แต้มทันที<br>• ทุก 25 บาท = 1 แต้ม แลกเป็นส่วนลดออเดอร์ถัดไปได้ค่ะ' },
    { k:['เจ้าหน้าที่','แอดมิน','คนจริง','ติดต่อ','โทร','admin'], a:'ส่งต่อเจ้าหน้าที่ 👩‍💼<br>กำลังส่งเรื่องให้ทีมงานดูแลต่อค่ะ ระหว่างนี้ติดต่อได้ที่ <b>hello@teenstyle.ai</b> หรือ <b>02-000-0000</b> (จ.–ส. 9:00–18:00) ค่ะ' },
    { k:['สไตล์','แนะนำ','ใส่อะไร','จัดชุด','ลุค','stylist'], a:'ถ้าอยากได้คำแนะนำการแต่งตัว กดแท็บ <b>✧ AI Stylist</b> ด้านบนได้เลยค่ะ ตอบ 4 คำถามสั้น ๆ แล้วระบบจะจัดลุคให้ทันที 💜' },
    { k:['สินค้า','มีอะไร','ขายอะไร','ราคา','เสื้อ','กางเกง','เดรส'], a:'ร้านเรามีทั้งเสื้อยืด เสื้อครอป ฮู้ดดี้ แจ็คเก็ต ยีนส์ คาร์โก้ กระโปรง เดรส หมวก และสนีกเกอร์ ราคาเริ่มต้น 290 บาทค่ะ ลองพิมพ์ชื่อสินค้าที่สนใจ หรือใช้ช่องค้นหาด้านบนได้เลยค่ะ' },
    { k:['สวัสดี','หวัดดี','ดีจ้า','hello','hi'], a:'สวัสดีค่ะ 💜 มีอะไรให้ช่วยดูแลบ้างคะ ถามเรื่องสินค้า คำสั่งซื้อ การชำระเงิน การจัดส่ง หรือการคืนสินค้าได้เลยค่ะ' }
  ];

  const SUPPORT_QUICK = ['จัดส่งกี่วัน', 'คืนสินค้าได้ไหม', 'ช่องทางชำระเงิน', 'เลือกไซซ์', 'ติดตามพัสดุ', 'คุยกับเจ้าหน้าที่'];

  const chat = { mode:'stylist', logs:{ stylist:[], support:[] }, answers:{}, step:0, done:false, spin:0, busy:false };

  function bubbleHTML(who, html) {
    return who === 'ai'
      ? '<div class="msg msg--ai"><span class="msg__av">' + (chat.mode === 'support' ? '💬' : '✧') + '</span><div class="msg__bubble">' + html + '</div></div>'
      : '<div class="msg msg--me"><div class="msg__bubble">' + html + '</div></div>';
  }
  function appendMsg(who, html) {
    chatLog.insertAdjacentHTML('beforeend', bubbleHTML(who, html));
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function pushMsg(who, html) {
    chat.logs[chat.mode].push({ who: who, html: html });
    appendMsg(who, html);
  }
  function renderLog() {
    chatLog.innerHTML = chat.logs[chat.mode].map(m => bubbleHTML(m.who, m.html)).join('');
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function showTyping() {
    chatLog.insertAdjacentHTML('beforeend',
      '<div class="msg msg--ai" id="typing"><span class="msg__av">' + (chat.mode === 'support' ? '💬' : '✧') +
      '</span><div class="msg__bubble"><span class="dots"><i></i><i></i><i></i></span></div></div>');
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function aiSay(html, after) {
    const mode = chat.mode;           // กันกรณีผู้ใช้สลับแท็บระหว่างที่ AI กำลังพิมพ์
    chat.busy = true;
    chatQuick.innerHTML = '';
    showTyping();
    setTimeout(function () {
      const t = $('#typing');
      if (t) t.remove();
      chat.busy = false;
      chat.logs[mode].push({ who:'ai', html:html });
      if (chat.mode !== mode) return; // สลับแท็บไปแล้ว — เก็บไว้ใน log เดิมเท่านั้น
      appendMsg('ai', html);
      if (after) after();
    }, 480 + Math.random() * 320);
  }
  function setQuick(items) {
    chatQuick.innerHTML = items.map(it =>
      '<button class="chip chip--sm" type="button" data-quick="' + esc(it.value) + '">' + esc(it.label) + '</button>').join('');
  }

  function askStep() {
    const step = FLOW[chat.step];
    if (!step) return recommend();
    aiSay(step.q, function () { setQuick(step.options); });
  }

  function scoreProduct(p, a) {
    let s = p.rating;
    if (a.style && p.styles.indexOf(a.style) > -1) s += 8;
    if (a.occasion && p.occasions.indexOf(a.occasion) > -1) s += 6;
    if (a.tone && p.tones.indexOf(a.tone) > -1) s += 4;
    const band = p.price <= 500 ? 'low' : (p.price <= 1000 ? 'mid' : 'high');
    if (a.budget) s += (band === a.budget) ? 5 : 1;
    return s;
  }

  function recommend() {
    const a = chat.answers;
    const ranked = PRODUCTS.slice().sort((x, y) => scoreProduct(y, a) - scoreProduct(x, a));
    const start = (chat.spin * 3) % Math.max(ranked.length - 2, 1);
    const picks = ranked.slice(start, start + 3);
    const total = picks.reduce((s, p) => s + p.price, 0);

    const summary = [
      a.style ? STYLE_LABEL[a.style] : null,
      a.tone ? ({ mono:'โทนขาว–ดำ', pastel:'โทนพาสเทล', earth:'โทนเอิร์ธ', bright:'สีสด' })[a.tone] : null,
      a.occasion ? 'ใส่ไป' + a.occasion : null
    ].filter(Boolean).join(' · ');

    const html = 'จัดลุคให้แล้ว! ✨<br>' + (summary ? '<b>' + esc(summary) + '</b><br>' : '') +
      'แนะนำ 3 ชิ้นนี้ รวม <b>' + baht(total) + '</b>' +
      '<div class="rec">' + picks.map(p => rowItem(p)).join('') + '</div>';

    aiSay(html, function () {
      chat.done = true;
      syncWishUI();
      setQuick([
        { label:'ขอลุคอื่น 🔄', value:'__again' },
        { label:'เริ่มใหม่', value:'__reset' },
        { label:'ถามเรื่องจัดส่ง', value:'__support' }
      ]);
    });
  }

  function answerSupport(text) {
    const t = text.toLowerCase();
    const hit = SUPPORT_KB.filter(item => item.k.some(k => t.indexOf(k.toLowerCase()) > -1))[0];
    const found = searchProducts(text);
    if (!hit && found.length) {
      return 'เจอสินค้าที่น่าจะตรงกับที่ถามค่ะ 👇<div class="rec">' + found.slice(0, 3).map(p => rowItem(p)).join('') + '</div>';
    }
    return hit ? hit.a
      : 'ขอโทษค่ะ เรื่องนี้ยังตอบแทนไม่ได้ 🙏 กำลัง<b>ส่งต่อให้เจ้าหน้าที่</b>ดูแลต่อค่ะ<br>ระหว่างนี้ถามเรื่องสินค้า การสั่งซื้อ ชำระเงิน จัดส่ง หรือการคืนสินค้าได้เลยค่ะ';
  }

  function startMode(mode) {
    chat.mode = mode;
    $('#aiTitle').textContent = mode === 'support' ? 'AI Customer Service' : 'AI Stylist';
    $('#aiAvatar').textContent = mode === 'support' ? '💬' : '✧';
    $$('.tab').forEach(t => {
      const on = t.dataset.tab === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    chatInput.placeholder = mode === 'support' ? 'ถามได้เลย เช่น ส่งกี่วันถึง…' : 'พิมพ์สไตล์หรือสิ่งที่อยากได้…';

    renderLog();
    chatQuick.innerHTML = '';

    if (chat.logs[mode].length) {
      if (mode === 'support') setQuick(SUPPORT_QUICK.map(s => ({ label:s, value:s })));
      else if (chat.done) setQuick([{ label:'ขอลุคอื่น 🔄', value:'__again' }, { label:'เริ่มใหม่', value:'__reset' }]);
      else if (FLOW[chat.step]) setQuick(FLOW[chat.step].options);
      return;
    }

    if (mode === 'stylist') {
      aiSay('สวัสดี! เราคือ <b>AI Stylist</b> ของ TeenStyle ✧<br>ตอบ 4 คำถามสั้น ๆ แล้วเราจะจัดลุคที่เหมาะกับคุณให้เลย 💜', askStep);
    } else {
      aiSay('สวัสดีค่ะ 💬 นี่คือ <b>AI Customer Service</b> ของ TeenStyle<br>สอบถามเรื่องสินค้า คำสั่งซื้อ การชำระเงิน การจัดส่ง หรือการคืนสินค้าได้เลยค่ะ', function () {
        setQuick(SUPPORT_QUICK.map(s => ({ label:s, value:s })));
      });
    }
  }

  function resetStylist() {
    chat.logs.stylist = [];
    chat.answers = {};
    chat.step = 0;
    chat.done = false;
    chat.spin = 0;
    startMode('stylist');
  }

  /** จัดการข้อความ/ตัวเลือกที่ผู้ใช้ส่งเข้ามา */
  function handleUserInput(value, label) {
    if (chat.busy) return;

    if (value === '__reset') { resetStylist(); return; }
    if (value === '__support') { startMode('support'); return; }
    if (value === '__again') {
      pushMsg('me', 'ขอลุคอื่น 🔄');
      chat.spin += 1;
      recommend();
      return;
    }

    pushMsg('me', esc(label || value));

    if (chat.mode === 'support') {
      aiSay(answerSupport(value), function () {
        setQuick(SUPPORT_QUICK.map(s => ({ label:s, value:s })));
        syncWishUI();
      });
      return;
    }

    // โหมด AI Stylist
    const step = FLOW[chat.step];
    if (step) {
      const raw = String(value).toLowerCase();
      const match = step.options.filter(o =>
        o.value.toLowerCase() === raw || o.label.toLowerCase() === raw ||
        raw.indexOf(o.value.toLowerCase()) > -1 || raw.indexOf(o.label.toLowerCase()) > -1)[0];
      if (match) chat.answers[step.key] = match.value;
      chat.step += 1;
      askStep();
      return;
    }

    // ตอบครบแล้ว → ใช้ข้อความเป็นคำค้นหา
    const found = searchProducts(value);
    if (found.length) {
      aiSay('น่าจะถูกใจ 3 ชิ้นนี้ค่ะ ✨<div class="rec">' + found.slice(0, 3).map(p => rowItem(p)).join('') + '</div>',
        function () { syncWishUI(); setQuick([{ label:'ขอลุคอื่น 🔄', value:'__again' }, { label:'เริ่มใหม่', value:'__reset' }]); });
    } else {
      chat.spin += 1;
      recommend();
    }
  }

  chatQuick.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-quick]');
    if (!btn) return;
    handleUserInput(btn.dataset.quick, btn.textContent.trim());
  });

  $$('.tab').forEach(t => t.addEventListener('click', function () {
    if (chat.mode !== t.dataset.tab) startMode(t.dataset.tab);
  }));

  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const v = chatInput.value.trim();
    if (!v) return;
    chatInput.value = '';
    handleUserInput(v, v);
  });

  /* ===== 8. NAV ===== */
  const navEl = $('#nav');
  function onScroll() { navEl.classList.toggle('is-stuck', window.pageYOffset > 20); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const navLinks = $$('.nav__link');
  const navMap = {};
  navLinks.forEach(l => { navMap[l.getAttribute('href')] = l; });

  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(function (entries) {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const link = navMap['#' + en.target.id];
        if (!link) return;
        navLinks.forEach(l => l.classList.remove('is-active'));
        link.classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['home', 'shop', 'looks', 'services', 'about'].forEach(id => {
      const el = document.getElementById(id);
      if (el) spy.observe(el);
    });
  }

  /* ===== 9. SMOOTH SCROLL (ชดเชยความสูง navbar) ===== */
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.length < 2) return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    closeOverlay();
    const top = target.getBoundingClientRect().top + window.pageYOffset - (navEl.offsetHeight + 10);
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    try { history.replaceState(null, '', href); } catch (err) { /* file:// */ }
  });

  /* ===== 10. REVEAL ON SCROLL ===== */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-visible');
        obs.unobserve(en.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach(el => io.observe(el));
  } else {
    $$('.reveal').forEach(el => el.classList.add('is-visible'));
  }

  /* ===== 11. OVERLAY MANAGER ===== */
  const PANELS = { menu:'#panel-menu', search:'#panel-search', cart:'#panel-cart', wishlist:'#panel-wishlist', account:'#panel-account', ai:'#panel-ai' };
  const backdrop = $('#backdrop');
  let openKey = null;
  let lastFocused = null;

  function openOverlay(key) {
    const panel = $(PANELS[key]);
    if (!panel) return;
    if (openKey && openKey !== key) closeOverlay(true);
    lastFocused = document.activeElement;
    openKey = key;
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('is-locked');
    if (key === 'menu') $('.nav__burger').setAttribute('aria-expanded', 'true');
    const focusable = panel.querySelector('input, button, a[href]');
    if (focusable) setTimeout(() => focusable.focus(), 60);
  }

  function closeOverlay(keepLock) {
    if (!openKey) return;
    const panel = $(PANELS[openKey]);
    if (panel) panel.hidden = true;
    if (openKey === 'menu') $('.nav__burger').setAttribute('aria-expanded', 'false');
    openKey = null;
    if (!keepLock) {
      backdrop.hidden = true;
      document.body.classList.remove('is-locked');
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
  }

  document.addEventListener('click', function (e) {
    const opener = e.target.closest('[data-open]');
    if (opener) { openOverlay(opener.dataset.open); return; }

    const aiBtn = e.target.closest('[data-ai]');
    if (aiBtn) {
      const mode = aiBtn.dataset.ai === 'support' ? 'support' : 'stylist';
      openOverlay('ai');
      startMode(mode);
      return;
    }

    if (e.target.closest('[data-close]') || e.target === backdrop) closeOverlay();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openKey) { closeOverlay(); return; }

    // กด "/" เพื่อเปิดช่องค้นหา (เมื่อไม่ได้อยู่ในช่องกรอกข้อมูล)
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !openKey) { e.preventDefault(); openOverlay('search'); return; }

    // focus trap ภายใน overlay ที่เปิดอยู่
    if (e.key === 'Tab' && openKey) {
      const panel = $(PANELS[openKey]);
      if (!panel) return;
      const items = $$('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])', panel)
        .filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ===== 12. FAQ ACCORDION ===== */
  $$('.faq__q').forEach(btn => {
    btn.addEventListener('click', function () {
      const item = btn.closest('.faq__item');
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      const isOpen = btn.getAttribute('aria-expanded') === 'true';

      $$('.faq__item').forEach(other => {
        if (other === item) return;
        other.classList.remove('is-open');
        const b = $('.faq__q', other);
        b.setAttribute('aria-expanded', 'false');
        document.getElementById(b.getAttribute('aria-controls')).hidden = true;
      });

      btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      item.classList.toggle('is-open', !isOpen);
      panel.hidden = isOpen;
    });
  });

  /* ===== 13. IMAGE FALLBACK (กันเลย์เอาต์พังเมื่อโหลดรูปไม่สำเร็จ) ===== */
  document.addEventListener('error', function (e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.failed) return;
    img.dataset.failed = '1';
    const box = document.createElement('div');
    box.className = 'img-fallback';
    box.textContent = img.dataset.fallback || 'TeenStyle';
    if (img.parentNode) img.parentNode.replaceChild(box, img);
  }, true);

  /* ===== GLOBAL ACTIONS: add to cart / wishlist / qty / delete / demo ===== */
  document.addEventListener('click', function (e) {
    const add = e.target.closest('[data-add]');
    if (add) { addToCart(add.dataset.add); return; }

    const wish = e.target.closest('[data-wish]');
    if (wish) { toggleWish(wish.dataset.wish); return; }

    const qtyBtn = e.target.closest('[data-qty]');
    if (qtyBtn) { changeQty(qtyBtn.dataset.target, parseInt(qtyBtn.dataset.qty, 10)); return; }

    const del = e.target.closest('[data-del]');
    if (del) { removeFromCart(del.dataset.del); return; }

    const filter = e.target.closest('[data-filter]');
    if (filter) {
      $$('[data-filter]').forEach(c => c.classList.remove('is-active'));
      filter.classList.add('is-active');
      renderProducts(filter.dataset.filter);
      return;
    }

    if (e.target.closest('#checkoutBtn')) {
      toast('บันทึกคำสั่งซื้อตัวอย่างแล้ว — ระบบชำระเงินจริงจะเชื่อมต่อในขั้นถัดไป 💜');
      return;
    }
    if (e.target.closest('[data-demo]')) {
      toast('หน้านี้เป็น Landing Page ตัวอย่าง ระบบสมาชิกจะเปิดใช้งานเร็ว ๆ นี้ ⭐');
    }
  });

  /* ===== TOAST ===== */
  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ===== INIT ===== */
  renderProducts('all');
  renderCart();
  renderWishlist();
  syncBadges();
  syncWishUI();
  renderSearch('');
});
