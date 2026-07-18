let activeKey = '';
let otpInterval = null;
let otpTimeout = null;
let adminKey = ''; // Verified admin session key

// Bind public UI tabs
document.getElementById('btn-submit-key').addEventListener('click', () => verifyKey());
document.getElementById('activation-key').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') verifyKey();
});

const navBtnHome = document.getElementById('nav-btn-home');
const navBtnCatalog = document.getElementById('nav-btn-catalog');
const keySection = document.getElementById('key-section');
const catalogSection = document.getElementById('catalog-section');
const productCard = document.getElementById('product-card');

navBtnHome.onclick = () => {
  navBtnHome.classList.add('active');
  navBtnCatalog.classList.remove('active');
  keySection.style.display = 'block';
  catalogSection.style.display = 'none';
  productCard.style.display = 'none';
};

navBtnCatalog.onclick = () => {
  navBtnCatalog.classList.add('active');
  navBtnHome.classList.remove('active');
  catalogSection.style.display = 'block';
  keySection.style.display = 'none';
  productCard.style.display = 'none';
  loadStorefrontCatalog();
};

// Verify key action
async function verifyKey(otpCode = '') {
  const keyInput = document.getElementById('activation-key').value.trim();
  
  if (!keyInput) {
    showAlert('Lütfen bir teslimat anahtarı (key) girin!', 'error');
    return;
  }

  try {
    const payload = { key: keyInput };
    if (otpCode) {
      payload.code = otpCode;
    }

    const response = await fetch('/api/verify-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || 'Anahtar doğrulanırken bir hata oluştu!', 'error');
      return;
    }

    // Handshake: Require 2FA OTP for Admin
    if (data.require2Fa) {
      const modal2fa = document.getElementById('admin-2fa-modal');
      const otpInput = document.getElementById('admin-otp-input');
      const submitBtn = document.getElementById('admin-2fa-btn-submit');
      const cancelBtn = document.getElementById('admin-2fa-btn-cancel');

      modal2fa.style.display = 'flex';
      otpInput.value = '';
      otpInput.focus();

      submitBtn.onclick = () => {
        const code = otpInput.value.trim();
        if (code.length === 6) {
          modal2fa.style.display = 'none';
          verifyKey(code);
        } else {
          alert('Lütfen 6 haneli doğrulama kodunu girin!');
        }
      };

      cancelBtn.onclick = () => {
        modal2fa.style.display = 'none';
      };
      return;
    }

    if (data.isAdmin) {
      adminKey = data.adminKey;
      hideAlert();
      renderAdminDashboard();
      return;
    }

    activeKey = keyInput;
    hideAlert();
    displayProduct(data.product, data.boundIp, data.remainingRequests);

  } catch (error) {
    showAlert('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.', 'error');
  }
}

// Display product details card
function displayProduct(product, boundIp, remainingRequests) {
  keySection.style.display = 'none';
  catalogSection.style.display = 'none';
  document.querySelector('.subtitle').innerText = 'Ürününüz Hazır!';

  const customModal = document.getElementById('custom-modal');
  document.getElementById('btn-back').onclick = () => {
    customModal.style.display = 'flex';
  };

  document.getElementById('modal-btn-confirm').onclick = () => {
    window.location.reload();
  };

  document.getElementById('modal-btn-cancel').onclick = () => {
    customModal.style.display = 'none';
  };

  document.getElementById('product-name').innerText = product.name;
  const prodDescEl = document.getElementById('product-desc');
  if (prodDescEl) {
    prodDescEl.innerText = product.details || 'Açıklama bulunmuyor.';
  }

  const detailsBox = document.getElementById('account-details-box');
  if (product.email && (product.email.includes('Linki') || product.email.toLowerCase().includes('link'))) {
    let linkUrl = product.password;
    let passwordValue = '';

    if (product.password.includes('Link:') && product.password.includes('Şifre:')) {
      const linkMatch = product.password.match(/Link:\s*(https?:\/\/[^\s|]+)/i);
      const passMatch = product.password.match(/Şifre:\s*([^\s|]+)/i);
      if (linkMatch) linkUrl = linkMatch[1];
      if (passMatch) passwordValue = passMatch[1];
    }

    let boxHtml = `
      <div class="credentials-row">
        <div>
          <div class="cred-label">İndirme Linki</div>
          <div id="cred-link" class="cred-value" style="word-break: break-all; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${linkUrl}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="copy-icon-btn" onclick="copyText('cred-link')" title="Linki Kopyala">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="copy-icon-btn" onclick="window.open('${linkUrl}', '_blank')" title="Git ve İndir" style="background: var(--accent-purple); color: #fff; border-color: var(--accent-purple);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
        </div>
      </div>
    `;

    if (passwordValue) {
      boxHtml += `
        <div class="credentials-row">
          <div>
            <div class="cred-label">Dosya Şifresi</div>
            <div id="cred-file-pw" class="cred-value">${passwordValue}</div>
          </div>
          <button class="copy-icon-btn" onclick="copyText('cred-file-pw')" title="Şifreyi Kopyala">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
      `;
    }
    detailsBox.innerHTML = boxHtml;
  } else {
    detailsBox.innerHTML = `
      <div class="credentials-row">
        <div>
          <div class="cred-label">Kullanıcı Adı / E-posta</div>
          <div id="cred-email" class="cred-value">${product.email || '-'}</div>
        </div>
        <button class="copy-icon-btn" onclick="copyText('cred-email')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
      <div class="credentials-row">
        <div>
          <div class="cred-label">Şifre</div>
          <div id="cred-password" class="cred-value">${product.password || '-'}</div>
        </div>
        <button class="copy-icon-btn" onclick="copyText('cred-password')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
    `;
  }
  
  if (product.image) {
    document.getElementById('product-image').src = product.image;
  } else {
    document.getElementById('product-image').src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800';
  }

  const codeSection = document.getElementById('code-section');
  const btnGetCode = document.getElementById('btn-get-code');
  const remainingCodesEl = document.getElementById('remaining-codes');

  if (remainingCodesEl) {
    remainingCodesEl.innerText = `${remainingRequests}/3`;
  }

  if (product.hasImap || product.has2Fa) {
    codeSection.style.display = 'block';
    btnGetCode.onclick = () => fetchCode(product);
    if (remainingRequests <= 0) {
      btnGetCode.disabled = true;
      btnGetCode.innerText = 'Kod Alma Hakkınız Doldu!';
    }
  } else {
    codeSection.style.display = 'none';
  }

  productCard.style.display = 'block';
}

async function fetchCode(product) {
  const btn = document.getElementById('btn-get-code');
  const codeDisplay = document.getElementById('code-display');
  const infoBox = document.getElementById('code-info-box');
  
  btn.disabled = true;
  btn.innerText = 'Kod Çekiliyor...';
  codeDisplay.style.display = 'none';

  const endpoint = product.hasImap ? '/api/get-email-code' : '/api/get-otp';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: activeKey })
    });

    const data = await response.json();

    if (!response.ok) {
      showAlert(data.error || 'Doğrulama kodu bulunamadı!', 'error');
      btn.disabled = false;
      btn.innerText = 'Giriş Kodu Al (Kod Al)';
      return;
    }

    hideAlert();
    codeDisplay.innerText = data.code || data.token;
    codeDisplay.style.display = 'block';

    const remainingCodesEl = document.getElementById('remaining-codes');
    if (remainingCodesEl && typeof data.remainingRequests !== 'undefined') {
      remainingCodesEl.innerText = `${data.remainingRequests}/3`;
      if (data.remainingRequests <= 0) {
        btn.disabled = true;
        btn.innerText = 'Kod Alma Hakkınız Doldu!';
      }
    }

    if (product.has2Fa && data.timeRemaining) {
      let remaining = data.timeRemaining;
      infoBox.innerHTML = `Yeni kodun üretilmesine kalan süre: <span style="color: var(--accent-pink); font-weight:700;">${remaining}</span> sn`;
      btn.style.display = 'none';

      clearInterval(otpInterval);
      otpInterval = setInterval(() => {
        remaining--;
        infoBox.innerHTML = `Yeni kodun üretilmesine kalan süre: <span style="color: var(--accent-pink); font-weight:700;">${remaining}</span> sn`;
        if (remaining <= 0) {
          clearInterval(otpInterval);
          if (typeof data.remainingRequests !== 'undefined' && data.remainingRequests > 0) {
            btn.disabled = false;
            btn.innerText = 'Giriş Kodu Al (Kod Al)';
            btn.style.display = 'flex';
          }
          codeDisplay.style.display = 'none';
          infoBox.innerText = 'Giriş ekranında kod gönderildikten sonra butona tıklayın.';
        }
      }, 1000);
    } else {
      if (typeof data.remainingRequests !== 'undefined' && data.remainingRequests > 0) {
        btn.disabled = false;
        btn.innerText = 'Kodu Tekrar Çek';
      }
      infoBox.innerText = 'E-posta kodu başarıyla çekildi.';
    }

  } catch (error) {
    showAlert('Sunucu hatası nedeniyle kod alınamadı.', 'error');
    btn.disabled = false;
    btn.innerText = 'Giriş Kodu Al (Kod Al)';
  }
}

// Load storefront product catalog
async function loadStorefrontCatalog() {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '<div style="color: var(--text-secondary); text-align:center; grid-column: 1/-1;">Ürünler yükleniyor...</div>';

  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    grid.innerHTML = '';
    
    if (data.products.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-secondary); text-align:center; grid-column: 1/-1;">Katalogda ürün bulunmamaktadır.</div>';
      return;
    }

    data.products.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.style.display = 'block';
      card.style.margin = '0';
      card.style.padding = '15px';
      card.style.background = 'rgba(255, 255, 255, 0.02)';
      card.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      card.style.borderRadius = '20px';
      
      card.innerHTML = `
        <div class="product-image-container" style="height: 120px; border-radius: 12px; margin-bottom: 12px;">
          <img class="product-image" src="${p.image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400'}" alt="${p.name}" style="height:100%;">
        </div>
        <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 12px; text-align: center; color: #fff;">${p.name}</h3>
        <button class="btn" onclick="window.open('${p.buyUrl || 'https://www.itemsatis.com/p/ACHAWSHOP'}', '_blank')" style="padding: 10px 14px; font-size:0.85rem;">
          <span>Satın Al</span>
        </button>
      `;
      grid.appendChild(card);
      apply3DTilt(card);
    });

  } catch(err) {
    grid.innerHTML = '<div style="color: #fca5a5; text-align:center; grid-column: 1/-1;">Ürünler yüklenirken sunucu hatası oluştu!</div>';
  }
}

// Check and render announcement
async function checkAnnouncements() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    
    if (data.announcementText && data.announcementId) {
      const dismissedId = localStorage.getItem('announcementDismissed');
      if (dismissedId !== data.announcementId) {
        const modal = document.getElementById('announcement-modal');
        document.getElementById('announcement-modal-text').innerText = data.announcementText;
        modal.style.display = 'flex';
        
        document.getElementById('announcement-btn-close').onclick = () => {
          localStorage.setItem('announcementDismissed', data.announcementId);
          modal.style.display = 'none';
        };
      }
    }
  } catch(e) {
    console.error("Announcement check failed", e);
  }
}

function showAlert(message, type) {
  const alertBox = document.getElementById('alert-box');
  if (alertBox) {
    alertBox.innerText = message;
    alertBox.style.display = 'block';
    alertBox.className = type === 'error' ? 'alert alert-error' : 'alert alert-success';
  }
}

function hideAlert() {
  const alertBox = document.getElementById('alert-box');
  if (alertBox) alertBox.style.display = 'none';
}

function copyText(elementId) {
  const text = document.getElementById(elementId).innerText;
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById(elementId).style.color = '#34d399';
    setTimeout(() => {
      document.getElementById(elementId).style.color = '';
    }, 1000);
  });
}

function apply3DTilt(element) {
  element.style.transformStyle = 'preserve-3d';
  element.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease';

  element.addEventListener('mousemove', (e) => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((centerY - y) / centerY) * 10;
    const rotateY = ((x - centerX) / centerX) * 10;

    element.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
  });

  element.addEventListener('mouseleave', () => {
    element.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
    element.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
  });
}

// Security: Prevent F12 / Inspect / Right Click / Source View
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12') { e.preventDefault(); return false; }
  if (e.ctrlKey && e.shiftKey && e.key === 'I') { e.preventDefault(); return false; }
  if (e.ctrlKey && e.shiftKey && e.key === 'J') { e.preventDefault(); return false; }
  if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false; }
  if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); return false; }
});

// Load resources on start
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn').forEach(el => apply3DTilt(el));
  checkAnnouncements();
});

window.addEventListener('load', () => {
  setTimeout(() => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.style.opacity = '0';
      preloader.style.visibility = 'hidden';
    }
  }, 1800);
});

// --- Dynamic Admin Dashboard Injection ---
function renderAdminDashboard() {
  document.querySelector('.container').style.maxWidth = '1150px';
  document.querySelector('.public-nav').style.display = 'none'; // Hide public navigation tabs
  const panel = document.getElementById('auth-panel');
  
  panel.innerHTML = `
    <div class="admin-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px; margin-bottom:30px;">
      <div>
        <h1 style="text-align:left; font-size:2.4rem;">ACHAW SHOP</h1>
        <p class="subtitle" style="text-align:left; margin-bottom:0;">GİZLİ YÖNETİCİ PANELİ</p>
      </div>
      <div class="tab-buttons" style="display: flex; align-items: center;">
        <button class="tab-btn active" id="tab-btn-products">Ürünler</button>
        <button class="tab-btn" id="tab-btn-keys">Anahtarlar (Keys)</button>
        <button class="tab-btn" id="tab-btn-settings">Ayarlar</button>
        <button class="tab-btn" id="tab-btn-logout" style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.15); color:#fca5a5; margin-left: 8px;">Çıkış</button>
      </div>
    </div>

    <!-- Admin Statistics Row -->
    <div class="admin-stats" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:20px; margin-bottom:30px;">
      <div class="stat-card" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:18px; padding:20px; text-align:center; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); margin-bottom:6px; font-weight:700;">Toplam Ürün</div>
        <div id="stat-total-products" style="font-size:1.8rem; font-weight:800; color:var(--accent-purple);">0</div>
      </div>
      <div class="stat-card" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:18px; padding:20px; text-align:center; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); margin-bottom:6px; font-weight:700;">Toplam Key</div>
        <div id="stat-total-keys" style="font-size:1.8rem; font-weight:800; color:var(--accent-blue);">0</div>
      </div>
      <div class="stat-card" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:18px; padding:20px; text-align:center; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); margin-bottom:6px; font-weight:700;">Aktif Key</div>
        <div id="stat-used-keys" style="font-size:1.8rem; font-weight:800; color:#34d399;">0</div>
      </div>
      <div class="stat-card" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:18px; padding:20px; text-align:center; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); margin-bottom:6px; font-weight:700;">Boşta Key</div>
        <div id="stat-unused-keys" style="font-size:1.8rem; font-weight:800; color:#fbbf24;">0</div>
      </div>
    </div>

    <div id="dashboard-alert" class="alert"></div>

    <div class="admin-grid" style="display:grid; gap:30px;">
      <!-- Left side: Form -->
      <div class="panel" style="padding: 24px; box-shadow:none; border:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.2);">
        
        <!-- Simplified Products Creator Form -->
        <div id="admin-product-form">
          <h3 style="margin-bottom:20px; font-weight:700; color:var(--accent-purple);">Ürün Ekle / Düzenle</h3>
          <input type="hidden" id="prod-id">
          
          <div class="input-group">
            <label>Ürün Adı</label>
            <input type="text" id="prod-name" class="input-field" placeholder="Örn: AE Yazı Animasyonu" style="padding:10px 14px; font-size:0.95rem;">
          </div>
          
          <!-- Image Section -->
          <div class="input-group">
            <label>Ürün Resmi (Resim Seçin veya URL Girin)</label>
            <div style="display: flex; gap: 10px; align-items: center; margin-top: 8px;">
              <label for="prod-image-file" class="action-btn" style="display: inline-block; cursor: pointer; text-align: center; font-size: 0.85rem; padding: 10px 16px; background: rgba(168, 85, 247, 0.1); border-color: rgba(168, 85, 247, 0.3); color: #e9d5ff; white-space: nowrap; margin: 0; font-family: 'Space Grotesk', sans-serif;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; display: inline-block; vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Dosya Seç
              </label>
              <input type="file" id="prod-image-file" style="display: none;" accept="image/*">
              <span id="file-upload-status" style="font-size: 0.8rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">Dosya seçilmedi</span>
            </div>
            <input type="text" id="prod-image" class="input-field" placeholder="Veya Görsel URL'si girin" style="padding:10px 14px; font-size:0.95rem; margin-top:10px;">
          </div>

          <div class="input-group">
            <label>İndirme Linki (Giriş E-postası / Kullanıcı Adı)</label>
            <input type="text" id="prod-email" class="input-field" placeholder="İndirme Linki (veya e-posta adresi)" style="padding:10px 14px; font-size:0.95rem;">
          </div>
          <div class="input-group">
            <label>İndirme Linki URL'si / Şifre (İsteğe Bağlı)</label>
            <input type="text" id="prod-password" class="input-field" placeholder="Mega/Drive linki veya şifre" style="padding:10px 14px; font-size:0.95rem;">
          </div>
          <div class="input-group">
            <label>İtemSatış Satın Alma Linki (İsteğe Bağlı)</label>
            <input type="text" id="prod-buy-url" class="input-field" placeholder="https://www.itemsatis.com/..." style="padding:10px 14px; font-size:0.95rem;">
          </div>
          <div class="input-group" style="flex-direction: row; align-items: center; gap: 10px; margin-top: 15px; margin-bottom: 5px;">
            <input type="checkbox" id="prod-is-active" checked style="width: auto; margin: 0; cursor: pointer;">
            <label for="prod-is-active" style="margin: 0; cursor: pointer; font-size: 0.9rem; color: #fff;">Bu Ürün Mağaza Vitrininde Gösterilsin (Aktif)</label>
          </div>
          
          <!-- Hidden details & extra configurations for advanced admin if needed -->
          <div style="margin-top: 15px; border-top:1px solid rgba(255,255,255,0.05); padding-top: 15px;">
            <button type="button" id="btn-toggle-advanced-product" class="action-btn" style="width:100%; text-align:center; padding:10px; font-size:0.8rem; background:rgba(255,255,255,0.01);">Gelişmiş Ayarları Göster (TOTP, IMAP, Detaylar)</button>
          </div>
          
          <div id="advanced-product-fields" style="display:none; margin-top:15px;">
            <div class="input-group">
              <label>2FA Secret Key (TOTP - İsteğe Bağlı)</label>
              <input type="text" id="prod-totp" class="input-field" placeholder="JBSWY3DPEHPK3PXP" style="padding:10px 14px; font-size:0.95rem;">
            </div>
            
            <h4 style="margin:15px 0 10px 0; color:var(--accent-blue); font-size:0.85rem; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:5px;">E-Postadan Kod Çekme (IMAP - İsteğe Bağlı)</h4>
            <div class="input-group">
              <label>IMAP Sunucu Adresi</label>
              <input type="text" id="prod-imap-host" class="input-field" placeholder="imap.gmail.com" style="padding:10px 14px; font-size:0.95rem;">
            </div>
            <div class="input-group">
              <label>IMAP Portu</label>
              <input type="text" id="prod-imap-port" class="input-field" value="993" style="padding:10px 14px; font-size:0.95rem;">
            </div>
            <div class="input-group">
              <label>IMAP E-posta Adresi</label>
              <input type="text" id="prod-imap-user" class="input-field" placeholder="hesap@domain.com" style="padding:10px 14px; font-size:0.95rem;">
            </div>
            <div class="input-group">
              <label>IMAP Şifresi / Uygulama Şifresi</label>
              <input type="password" id="prod-imap-password" class="input-field" placeholder="E-posta şifreniz" style="padding:10px 14px; font-size:0.95rem;">
            </div>
            <div class="input-group">
              <label>Ürün Açıklaması / Detaylar</label>
              <textarea id="prod-details" class="input-field" rows="2" placeholder="Bilgi notu..." style="padding:10px 14px; font-size:0.95rem; font-family:inherit; resize:vertical;"></textarea>
            </div>
          </div>

          <button id="btn-save-product" class="btn" style="padding:12px 20px; font-size:0.95rem; margin-top:20px;">Kaydet</button>
          <button id="btn-cancel-product" class="btn btn-secondary" style="padding:10px 20px; font-size:0.9rem; display:none; margin-top:10px;">Vazgeç</button>
        </div>

        <!-- Keys Form -->
        <div id="admin-key-form" style="display:none;">
          <h3 style="margin-bottom:20px; font-weight:700; color:var(--accent-purple);">Yeni Anahtar(lar) Oluştur</h3>
          
          <div class="input-group">
            <label>Bağlanacak Ürün</label>
            <select id="key-product-select" class="input-field" style="padding:10px 14px; font-size:0.95rem; background:#0b071a; color:#fff; border:1px solid rgba(255,255,255,0.08);"></select>
          </div>
          
          <div class="input-group">
            <label>Oluşturulacak Key Adeti (Miktar)</label>
            <input type="number" id="key-quantity" class="input-field" value="1" min="1" max="100" style="padding:10px 14px; font-size:0.95rem;">
          </div>

          <div class="input-group">
            <label>Özel Key Belirle (Sadece 1 Adet için Geçerlidir)</label>
            <input type="text" id="key-custom-string" class="input-field" placeholder="Örn: ACHAW-OZEL-KEY" style="padding:10px 14px; font-size:0.95rem;">
          </div>
          
          <button id="btn-generate-key" class="btn" style="padding:12px 20px; font-size:0.95rem;">Keyleri Üret</button>
          
          <div style="margin-top: 30px; border-top: 1px solid rgba(239, 68, 68, 0.2); padding-top: 20px;">
            <h4 style="color:#ef4444; margin-bottom:10px;">Kritik İşlemler</h4>
            <button id="btn-clear-all-keys" class="btn btn-secondary" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; padding:12px 20px; font-size:0.95rem;">Tüm Keyleri Sil</button>
          </div>
        </div>

        <!-- Settings Form -->
        <div id="admin-settings-form" style="display:none;">
          <h3 style="margin-bottom:20px; font-weight:700; color:var(--accent-purple);">Güvenlik Ayarları</h3>
          <div class="input-group">
            <label>Yeni Admin Giriş Anahtarı (Secret Key)</label>
            <input type="text" id="settings-new-key" class="input-field" placeholder="Yeni Gizli Giriş Keyi" style="padding:10px 14px; font-size:0.95rem;">
          </div>
          
          <h3 style="margin-top:25px; margin-bottom:15px; font-weight:700; color:var(--accent-purple);">Duyuru Gönder (Duyuru Sistemi)</h3>
          <div class="input-group">
            <label>Duyuru Metni (Boş bırakırsanız duyuru kaldırılır)</label>
            <textarea id="settings-announcement-text" class="input-field" rows="3" placeholder="Mağazamıza hoş geldiniz!..." style="padding:10px 14px; font-size:0.95rem; font-family:inherit; resize:vertical;"></textarea>
          </div>
          
          <button id="btn-save-settings" class="btn" style="padding:12px 20px; font-size:0.95rem; margin-bottom:25px;">Güncelle</button>

          <h3 style="margin-bottom:15px; font-weight:700; color:var(--accent-blue);">Google Authenticator 2FA Yapılandırması</h3>
          <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:15px; line-height:1.4;">Admin girişi yaparken sizden istenecek 2FA doğrulama kodunu kurmak için aşağıdaki QR kodunu telefonunuzdaki Google Authenticator uygulamasına taratın:</p>
          <div style="background:#fff; padding:10px; display:inline-block; border-radius:12px; margin-bottom:10px;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=otpauth%3A%2F%2Ftotp%2FACHAW-SHOP%3Fsecret%3DJBSWY3DPEHPK3PXP%26issuer%3DACHAW%2520SHOP" alt="2FA QR Code" style="display:block; width:180px; height:180px;">
          </div>
          <div style="font-size:0.8rem; font-family:monospace; color:var(--accent-cyan); margin-top:5px;">Manuel Giriş Anahtarı: JBSWY3DPEHPK3PXP</div>
        </div>
      </div>

      <!-- Right side: Table list -->
      <div class="panel" style="padding: 24px; box-shadow:none; border:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.2); min-height:400px; display:flex; flex-direction:column;">
        
        <!-- Products Table -->
        <div id="admin-products-table-section" style="flex:1;">
        <!-- Products Table -->
        <div id="admin-products-table-section" style="flex:1;">
          <h3 style="margin-bottom:15px; font-weight:700; color:var(--accent-purple);">Aktif Mağaza Vitrini</h3>
          <div class="table-container" style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; min-width:500px;">
              <thead>
                <tr>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Görsel</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Ürün Adı</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">2FA / IMAP</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">İşlemler</th>
                </tr>
              </thead>
              <tbody id="admin-products-tbody"></tbody>
            </table>
          </div>

          <h3 style="margin-top:35px; margin-bottom:15px; font-weight:700; color:#fca5a5;">Kapalı / Pasif İlanlar</h3>
          <div class="table-container" style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; min-width:500px;">
              <thead>
                <tr>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Görsel</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Ürün Adı</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">2FA / IMAP</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">İşlemler</th>
                </tr>
              </thead>
              <tbody id="admin-passive-products-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Keys Table -->
        <div id="admin-keys-table-section" style="display:none; flex:1; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
            <h3 style="margin:0; font-weight:700;">Anahtar Listesi</h3>
            <div style="display:flex; gap:10px; align-items:center;">
              <select id="keys-product-filter" class="input-field" style="width:200px; padding:8px 12px; font-size:0.85rem; margin:0; background:#0b071a; color:#fff; border:1px solid rgba(255,255,255,0.08);"></select>
              <input type="text" id="keys-search" class="input-field" placeholder="Anahtar veya IP ara..." style="width:220px; padding:8px 12px; font-size:0.85rem; margin:0;">
            </div>
          </div>
          
          <div class="table-container" style="overflow-x:auto; flex:1;">
            <table style="width:100%; border-collapse:collapse; min-width:600px;">
              <thead>
                <tr>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Anahtar</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Kullanım & IP</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">Kalan Hak</th>
                  <th style="text-align:left; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">İşlemler</th>
                </tr>
              </thead>
              <tbody id="admin-keys-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  // Apply responsive grid layout
  const adminGrid = document.querySelector('.admin-grid');
  const applyAdminGridStyle = () => {
    if (window.innerWidth >= 950) {
      adminGrid.style.gridTemplateColumns = '1fr 1.6fr';
    } else {
      adminGrid.style.gridTemplateColumns = '1fr';
    }
  };
  window.addEventListener('resize', applyAdminGridStyle);
  applyAdminGridStyle();

  // Tab switching logic
  const tabBtnProducts = document.getElementById('tab-btn-products');
  const tabBtnKeys = document.getElementById('tab-btn-keys');
  const tabBtnSettings = document.getElementById('tab-btn-settings');

  const formProducts = document.getElementById('admin-product-form');
  const formKeys = document.getElementById('admin-key-form');
  const formSettings = document.getElementById('admin-settings-form');

  const tableProducts = document.getElementById('admin-products-table-section');
  const tableKeys = document.getElementById('admin-keys-table-section');

  tabBtnProducts.onclick = () => switchTab('products');
  tabBtnKeys.onclick = () => { switchTab('keys'); loadProductsDropdown(); };
  tabBtnSettings.onclick = () => switchTab('settings');

  function switchTab(activeTab) {
    [tabBtnProducts, tabBtnKeys, tabBtnSettings].forEach(btn => btn.classList.remove('active'));
    [formProducts, formKeys, formSettings, tableProducts, tableKeys].forEach(el => el.style.display = 'none');

    if (activeTab === 'products') {
      tabBtnProducts.classList.add('active');
      formProducts.style.display = 'block';
      tableProducts.style.display = 'block';
      loadAdminProducts();
    } else if (activeTab === 'keys') {
      tabBtnKeys.classList.add('active');
      formKeys.style.display = 'block';
      tableKeys.style.display = 'flex';
      loadAdminKeys();
    } else if (activeTab === 'settings') {
      tabBtnSettings.classList.add('active');
      formSettings.style.display = 'block';
      loadAnnouncementInput();
    }
  }

  // Bind Actions
  document.getElementById('btn-save-product').onclick = saveAdminProduct;
  document.getElementById('btn-cancel-product').onclick = clearProductForm;
  document.getElementById('btn-generate-key').onclick = generateAdminKey;
  document.getElementById('btn-save-settings').onclick = saveAdminSettings;
  document.getElementById('btn-clear-all-keys').onclick = clearAllKeys;
  document.getElementById('tab-btn-logout').onclick = () => window.location.reload();
  
  // Advanced fields toggler
  document.getElementById('btn-toggle-advanced-product').onclick = () => {
    const fields = document.getElementById('advanced-product-fields');
    if (fields.style.display === 'none') {
      fields.style.display = 'block';
      document.getElementById('btn-toggle-advanced-product').innerText = 'Gelişmiş Ayarları Gizle';
    } else {
      fields.style.display = 'none';
      document.getElementById('btn-toggle-advanced-product').innerText = 'Gelişmiş Ayarları Göster';
    }
  };

  // Image File Uploader (Converts client image directly to Base64)
  document.getElementById('prod-image-file').onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      document.getElementById('file-upload-status').innerText = file.name;
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById('prod-image').value = event.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      document.getElementById('file-upload-status').innerText = 'Dosya seçilmedi';
    }
  };

  // Unified Keys Filter (Search & Product Selection)
  let allKeys = [];
  function applyKeysFilter() {
    const query = document.getElementById('keys-search').value.toLowerCase().trim();
    const selectedProduct = document.getElementById('keys-product-filter').value;
    
    const filtered = allKeys.filter(k => {
      // 1. Filter by product
      if (selectedProduct && k.productId !== selectedProduct) {
        return false;
      }
      // 2. Filter by search query
      if (query) {
        const matchesKey = k.key.toLowerCase().includes(query);
        const matchesIp = k.boundIp && k.boundIp.toLowerCase().includes(query);
        const matchesProd = k.productName && k.productName.toLowerCase().includes(query);
        return matchesKey || matchesIp || matchesProd;
      }
      return true;
    });
    renderKeysTable(filtered);
  }

  document.getElementById('keys-search').oninput = applyKeysFilter;
  document.getElementById('keys-product-filter').onchange = applyKeysFilter;

  // Initial Load
  loadAdminProducts();
  updateStatsDashboard();

  async function updateStatsDashboard() {
    try {
      const prodRes = await fetch('/api/admin/products', { headers: { 'X-Admin-Key': adminKey } });
      const prods = await prodRes.json();
      const keysRes = await fetch('/api/admin/keys', { headers: { 'X-Admin-Key': adminKey } });
      const keys = await keysRes.json();

      document.getElementById('stat-total-products').innerText = prods.length;
      document.getElementById('stat-total-keys').innerText = keys.length;
      
      const used = keys.filter(k => k.isUsed).length;
      document.getElementById('stat-used-keys').innerText = used;
      document.getElementById('stat-unused-keys').innerText = keys.length - used;
    } catch(err) {
      console.error(err);
    }
  }

  function showAdminAlert(msg, type) {
    const alertBox = document.getElementById('dashboard-alert');
    alertBox.innerText = msg;
    alertBox.style.display = 'block';
    alertBox.className = type === 'error' ? 'alert alert-error' : 'alert alert-success';
    setTimeout(() => { alertBox.style.display = 'none'; }, 4000);
  }

  async function loadAnnouncementInput() {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      document.getElementById('settings-announcement-text').value = data.announcementText || '';
    } catch(err) {
      console.error(err);
    }
  }

  async function loadAdminProducts() {
    try {
      const res = await fetch('/api/admin/products', { headers: { 'X-Admin-Key': adminKey } });
      const products = await res.json();
      
      const tbodyActive = document.getElementById('admin-products-tbody');
      const tbodyPassive = document.getElementById('admin-passive-products-tbody');
      
      tbodyActive.innerHTML = '';
      tbodyPassive.innerHTML = '';
      
      products.forEach(p => {
        const tr = document.createElement('tr');
        const activeBadge = p.isActive !== false ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-danger">Pasif</span>';
        const typeBadge = p.totpSecret || (p.imapHost && p.imapUser) ? '<span class="badge badge-success">2FA/IMAP</span>' : '<span class="badge badge-warning">Klasik</span>';
        
        const toggleButtonText = p.isActive !== false ? 'Kapat' : 'Aktif Et';
        const toggleButtonClass = p.isActive !== false ? 'btn-reset' : 'btn-reset';
        const toggleButtonStyle = p.isActive !== false ? '' : 'background:#10b981; border-color:#10b981; color:#fff;';
        
        tr.innerHTML = `
          <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05);"><img src="${p.image || 'https://images.unsplash.com/photo-1618005198143-e528346d9a59?w=60'}" style="width:45px; height:32px; object-fit:cover; border-radius:6px;"></td>
          <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05); font-weight:600;">${p.name}</td>
          <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05);">${activeBadge} ${typeBadge}</td>
          <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap;">
              <button class="action-btn" id="edit-p-${p.id}" style="padding:6px 12px; font-size:0.8rem; white-space:nowrap;">Düzelt</button>
              <button class="action-btn ${toggleButtonClass}" id="toggle-active-${p.id}" style="padding:6px 12px; font-size:0.8rem; white-space:nowrap; ${toggleButtonStyle}">${toggleButtonText}</button>
              <button class="action-btn btn-danger" id="del-p-${p.id}" style="padding:6px 12px; font-size:0.8rem; white-space:nowrap;">Sil</button>
            </div>
          </td>
        `;
        
        if (p.isActive !== false) {
          tbodyActive.appendChild(tr);
        } else {
          tbodyPassive.appendChild(tr);
        }

        // Bind Edit
        document.getElementById(`edit-p-${p.id}`).onclick = () => {
          document.getElementById('prod-id').value = p.id;
          document.getElementById('prod-name').value = p.name;
          document.getElementById('prod-image').value = p.image || '';
          document.getElementById('prod-email').value = p.email || '';
          document.getElementById('prod-password').value = p.password || '';
          document.getElementById('prod-buy-url').value = p.buyUrl || '';
          document.getElementById('prod-is-active').checked = p.isActive !== false;
          document.getElementById('prod-totp').value = p.totpSecret || '';
          document.getElementById('prod-imap-host').value = p.imapHost || '';
          document.getElementById('prod-imap-port').value = p.imapPort || '993';
          document.getElementById('prod-imap-user').value = p.imapUser || '';
          document.getElementById('prod-imap-password').value = p.imapPassword || '';
          document.getElementById('prod-details').value = p.details || '';
          document.getElementById('btn-cancel-product').style.display = 'inline-block';
          
          if (p.totpSecret || p.imapHost || p.details) {
            document.getElementById('advanced-product-fields').style.display = 'block';
            document.getElementById('btn-toggle-advanced-product').innerText = 'Gelişmiş Ayarları Gizle';
          }
        };

        // Bind Toggle Active/Passive
        document.getElementById(`toggle-active-${p.id}`).onclick = async () => {
          const updatedProduct = {
            ...p,
            isActive: p.isActive === false
          };
          const res = await fetch('/api/admin/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
            body: JSON.stringify(updatedProduct)
          });
          if (res.ok) {
            showAdminAlert(`${p.name} başarıyla ${updatedProduct.isActive ? 'Aktif vitrine alındı' : 'Kapatıldı/Pasif yapıldı'}.`, 'success');
            loadAdminProducts();
            updateStatsDashboard();
          } else {
            showAdminAlert('Ürün durumu güncellenemedi!', 'error');
          }
        };

        // Bind Delete
        document.getElementById(`del-p-${p.id}`).onclick = async () => {
          if (confirm('Bu ürünü silmek istediğinize emin misiniz?')) {
            const delRes = await fetch(`/api/admin/products/${p.id}`, { method: 'DELETE', headers: { 'X-Admin-Key': adminKey } });
            if (delRes.ok) {
              showAdminAlert('Ürün silindi.', 'success');
              loadAdminProducts();
              updateStatsDashboard();
            }
          }
        };
      });
    } catch (e) {
      showAdminAlert('Ürünler yüklenirken hata oluştu!', 'error');
    }
  }

  async function saveAdminProduct() {
    const payload = {
      id: document.getElementById('prod-id').value || undefined,
      name: document.getElementById('prod-name').value.trim(),
      image: document.getElementById('prod-image').value.trim(),
      email: document.getElementById('prod-email').value.trim(),
      password: document.getElementById('prod-password').value.trim(),
      buyUrl: document.getElementById('prod-buy-url').value.trim(),
      isActive: document.getElementById('prod-is-active').checked,
      totpSecret: document.getElementById('prod-totp').value.trim(),
      imapHost: document.getElementById('prod-imap-host').value.trim(),
      imapPort: document.getElementById('prod-imap-port').value.trim(),
      imapUser: document.getElementById('prod-imap-user').value.trim(),
      imapPassword: document.getElementById('prod-imap-password').value.trim(),
      details: document.getElementById('prod-details').value.trim()
    };

    if (!payload.name) {
      showAdminAlert('Ürün adı zorunludur!', 'error');
      return;
    }

    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showAdminAlert('Ürün başarıyla kaydedildi.', 'success');
      clearProductForm();
      loadAdminProducts();
      updateStatsDashboard();
    } else {
      showAdminAlert('Ürün kaydedilemedi!', 'error');
    }
  }

  function clearProductForm() {
    document.getElementById('prod-id').value = '';
    document.getElementById('prod-name').value = '';
    document.getElementById('prod-image').value = '';
    document.getElementById('prod-image-file').value = '';
    document.getElementById('file-upload-status').innerText = 'Dosya seçilmedi';
    document.getElementById('prod-email').value = '';
    document.getElementById('prod-password').value = '';
    document.getElementById('prod-buy-url').value = '';
    document.getElementById('prod-is-active').checked = true;
    document.getElementById('prod-totp').value = '';
    document.getElementById('prod-imap-host').value = '';
    document.getElementById('prod-imap-port').value = '993';
    document.getElementById('prod-imap-user').value = '';
    document.getElementById('prod-imap-password').value = '';
    document.getElementById('prod-details').value = '';
    document.getElementById('btn-cancel-product').style.display = 'none';
    document.getElementById('advanced-product-fields').style.display = 'none';
    document.getElementById('btn-toggle-advanced-product').innerText = 'Gelişmiş Ayarları Göster';
  }

  async function loadProductsDropdown() {
    const res = await fetch('/api/admin/products', { headers: { 'X-Admin-Key': adminKey } });
    const products = await res.json();
    const select = document.getElementById('key-product-select');
    select.innerHTML = '';
    products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.innerText = p.name;
      select.appendChild(opt);
    });

    const filterSelect = document.getElementById('keys-product-filter');
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="">Tüm Ürünler (Hepsi)</option>';
      products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = p.name;
        filterSelect.appendChild(opt);
      });
    }
  }

  async function loadAdminKeys() {
    try {
      const res = await fetch('/api/admin/keys', { headers: { 'X-Admin-Key': adminKey } });
      allKeys = await res.json();
      renderKeysTable(allKeys);
    } catch (e) {
      showAdminAlert('Anahtarlar yüklenirken hata oluştu!', 'error');
    }
  }

  function renderKeysTable(keysList) {
    const tbody = document.getElementById('admin-keys-tbody');
    tbody.innerHTML = '';
    keysList.forEach(k => {
      const tr = document.createElement('tr');
      const remaining = 3 - (k.codeRequestCount || 0);
      
      let usageInfo = `<span class="badge badge-warning">Boşta</span>`;
      if (k.isUsed) {
        usageInfo = `<span class="badge badge-success">Aktif</span><br><span style="font-size:0.75rem; color:var(--text-secondary);">${k.boundIp || 'IP Bilinmiyor'}</span>`;
      }

      const maskedKey = k.key.substring(0, 4) + '-••••-••••-••••';
      tr.innerHTML = `
        <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05); font-family:monospace; font-size:0.85rem; color:var(--accent-cyan);"><span class="key-mask-span" data-full-key="${k.key}">${maskedKey}</span><button class="action-btn btn-reset" style="padding: 2px 6px; font-size: 0.65rem; margin-left: 8px; cursor: pointer;" onclick="toggleKeyReveal(this)">Göster</button><br><span style="font-size:0.7rem; color:var(--text-secondary); font-family:inherit;">${k.productName || 'Silinmiş Ürün'}</span></td>
        <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05);">${usageInfo}</td>
        <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05); font-weight:700;">${remaining}/3</td>
        <td style="padding:15px 10px; border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap;">
            <button class="action-btn btn-reset" id="reset-k-${k.key}" style="padding:6px 12px; font-size:0.8rem; white-space:nowrap;">Sıfırla</button>
            <button class="action-btn btn-danger" id="del-k-${k.key}" style="padding:6px 12px; font-size:0.8rem; white-space:nowrap;">Sil</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      // Global window level toggle handler for masked keys
      window.toggleKeyReveal = (btn) => {
        const span = btn.previousElementSibling;
        const isMasked = span.innerText.includes('•');
        if (isMasked) {
          span.innerText = span.getAttribute('data-full-key');
          btn.innerText = 'Gizle';
        } else {
          const fullKey = span.getAttribute('data-full-key');
          span.innerText = fullKey.substring(0, 4) + '-••••-••••-••••';
          btn.innerText = 'Göster';
        }
      };

      document.getElementById(`reset-k-${k.key}`).onclick = async () => {
        const resetRes = await fetch('/api/admin/keys/reset-ip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
          body: JSON.stringify({ key: k.key })
        });
        if (resetRes.ok) {
          showAdminAlert(`${k.key} IP kilidi sıfırlandı ve 3 kullanım hakkı yenilenerek tekrar kullanılabilir yapıldı.`, 'success');
          loadAdminKeys();
          updateStatsDashboard();
        }
      };

      document.getElementById(`del-k-${k.key}`).onclick = async () => {
        if (confirm('Bu anahtarı silmek istediğinize emin misiniz?')) {
          const delRes = await fetch(`/api/admin/keys/${k.key}`, { method: 'DELETE', headers: { 'X-Admin-Key': adminKey } });
          if (delRes.ok) {
            showAdminAlert('Anahtar silindi.', 'success');
            loadAdminKeys();
            updateStatsDashboard();
          }
        }
      };
    });
  }

  async function generateAdminKey() {
    const productId = document.getElementById('key-product-select').value;
    const quantity = document.getElementById('key-quantity').value;
    const customKey = document.getElementById('key-custom-string').value.trim();

    if (!productId) {
      showAdminAlert('Lütfen bir ürün seçin!', 'error');
      return;
    }

    const res = await fetch('/api/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ productId, quantity, customKey })
    });

    const data = await res.json();
    if (res.ok) {
      if (Array.isArray(data)) {
        showAdminAlert(`${data.length} adet yeni anahtar başarıyla oluşturuldu.`, 'success');
      } else {
        showAdminAlert(`Anahtar oluşturuldu: ${data.key}`, 'success');
      }
      document.getElementById('key-custom-string').value = '';
      document.getElementById('key-quantity').value = '1';
      loadAdminKeys();
      updateStatsDashboard();
    } else {
      showAdminAlert(data.error || 'Anahtar oluşturulamadı!', 'error');
    }
  }

  async function clearAllKeys() {
    const clearModal = document.getElementById('clear-keys-modal');
    const btnNo = document.getElementById('clear-keys-btn-no');
    const btnYes = document.getElementById('clear-keys-btn-yes');

    clearModal.style.display = 'flex';

    btnNo.onclick = () => {
      clearModal.style.display = 'none';
    };

    btnYes.onclick = () => {
      clearModal.style.display = 'none';
      
      // Trigger 2FA Verification Modal for safety
      const modal2fa = document.getElementById('admin-2fa-modal');
      const otpInput = document.getElementById('admin-otp-input');
      const submitBtn = document.getElementById('admin-2fa-btn-submit');
      const cancelBtn = document.getElementById('admin-2fa-btn-cancel');

      modal2fa.style.display = 'flex';
      otpInput.value = '';
      otpInput.focus();

      submitBtn.onclick = async () => {
        const code = otpInput.value.trim();
        if (code.length === 6) {
          modal2fa.style.display = 'none';
          
          const res = await fetch('/api/admin/keys-clear-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
            body: JSON.stringify({ code })
          });
          
          const data = await res.json();
          if (res.ok) {
            showAdminAlert('Sistemdeki tüm anahtarlar silindi.', 'success');
            loadAdminKeys();
            updateStatsDashboard();
          } else {
            showAdminAlert(data.error || 'Silme işlemi gerçekleştirilemedi!', 'error');
          }
        } else {
          alert('Lütfen 6 haneli doğrulama kodunu girin!');
        }
      };

      cancelBtn.onclick = () => {
        modal2fa.style.display = 'none';
      };
    };
  }

  async function saveAdminSettings() {
    const newKey = document.getElementById('settings-new-key').value.trim();
    const announcementText = document.getElementById('settings-announcement-text').value.trim();

    const payload = {};
    if (newKey) payload.adminKey = newKey;
    payload.announcementText = announcementText;

    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      if (newKey) adminKey = newKey;
      document.getElementById('settings-new-key').value = '';
      showAdminAlert('Ayarlar başarıyla güncellendi.', 'success');
    } else {
      showAdminAlert('Ayarlar güncellenirken hata oluştu!', 'error');
    }
  }
}
