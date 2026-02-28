// =================== CONFIG ===================
const SUPABASE_URL = 'https://gpkufzayrvfippxqfafa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwa3VmemF5cnZmaXBweHFmYWZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NjMwNDQsImV4cCI6MjA4NTAzOTA0NH0.3YHPrjJ65mn20ECCYCvbO56jWWUVLy1IGFzXp83Gn9U';

// ✅ Import and initialize Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =================== APP CLASS ===================
class TesatikiApp {
  constructor() {
    this.products = [];
    this.allProducts = [];
    this.currentCategory = 'all';
    this.page = this.getPage();
    this.init();
  }

  init() {
    this.registerSW();
    this.setupBottomNav();
    this.setupScrollBehavior();
    this.setupSearch();
    this.setupCategories();
    this.loadPage();
    this.updateLastActive(); // Update current user's last_active
  }

  getPage() {
    const p = location.pathname.split('/').pop();
    if (p === 'sell.html') return 'sell';
    if (p === 'profile.html') return 'profile';
    return 'home';
  }

  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(() => console.log('✅ Service Worker registered'))
        .catch(err => console.error('❌ SW failed', err));
    }
  }

  // ✅ UPDATE USER'S LAST ACTIVE TIMESTAMP
  async updateLastActive() {
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser'));
      if (!currentUser || !currentUser.id) return;

      const { error } = await supabase
        .from('users')
        .update({ last_active: new Date().toISOString() })
        .eq('id', currentUser.id);

      if (error) {
        console.error('Failed to update last_active:', error);
      } else {
        console.log('✅ Last active updated');
      }
    } catch (err) {
      console.error('Error updating last_active:', err);
    }
  }

  setupBottomNav() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      });
    });

    navItems.forEach(item => {
      const href = item.getAttribute('href');
      if ((href === 'index.html' && this.page === 'home') || 
          href === location.pathname.split('/').pop()) {
        item.classList.add('active');
      }
    });
  }

  // ✅ IMPROVED SCROLL BEHAVIOR - BETTER PERFORMANCE
  setupScrollBehavior() {
    let lastScroll = 0;
    let ticking = false;
    const bottomNav = document.querySelector('.bottom-nav');
    const topBar = document.querySelector('.top-bar');
    
    if (!bottomNav || !topBar) return;
    
    const updateNavVisibility = () => {
      const currentScroll = window.scrollY;
      
      // Only update if scroll changed significantly
      if (Math.abs(currentScroll - lastScroll) < 5) {
        ticking = false;
        return;
      }
      
      // Hide/show navigation on scroll
      if (currentScroll > lastScroll && currentScroll > 100) {
        bottomNav.classList.add('hide');
        topBar.classList.add('hide');
      } else {
        bottomNav.classList.remove('hide');
        topBar.classList.remove('hide');
      }

      // Shrink navigation on scroll
      if (currentScroll > 50) {
        topBar.classList.add('shrink');
        bottomNav.classList.add('shrink');
      } else {
        topBar.classList.remove('shrink');
        bottomNav.classList.remove('shrink');
      }
      
      lastScroll = currentScroll;
      ticking = false;
    };
    
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateNavVisibility);
        ticking = true;
      }
    }, { passive: true });
  }

  setupSearch() {
    const searchInput = document.querySelector('.search-box input');
    const searchButton = document.querySelector('.search-btn');
    
    if (!searchInput || !searchButton) return;

    searchButton.addEventListener('click', () => {
      this.applyFilters();
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.applyFilters();
      }
    });

    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.applyFilters();
      }, 300);
    });
  }

  setupCategories() {
    const categoryLinks = document.querySelectorAll('.category-link');
    
    categoryLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        
        categoryLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        this.currentCategory = link.getAttribute('data-category');
        this.applyFilters();
      });
    });
  }

  applyFilters() {
    const searchInput = document.querySelector('.search-box input');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filtered = this.allProducts;

    if (this.currentCategory !== 'all') {
      filtered = filtered.filter(product => product.category === this.currentCategory);
    }

    if (searchTerm) {
      filtered = filtered.filter(product => {
        const name = (product.name || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        const location = (product.location || '').toLowerCase();
        const category = (product.category || '').toLowerCase();
        const seller = (product.seller_name || '').toLowerCase();
        
        return name.includes(searchTerm) || 
               description.includes(searchTerm) ||
               location.includes(searchTerm) ||
               category.includes(searchTerm) ||
               seller.includes(searchTerm);
      });
    }

    this.renderProducts(filtered);
  }

  async loadPage() {
    if (this.page === 'home') {
      await this.loadProducts();
    }
  }

  // ========================
  // ⭐ LOAD PRODUCTS FROM CACHED ENDPOINT
  // Uses /api/get-products with 10 minute cache
  // No auth required - anyone can view
  // ========================
  async loadProducts() {
    try {
      console.log('📦 Fetching products from /api/get-products (cached, 10 min)...');
      
      // ✅ Use cached endpoint instead of direct Supabase
      const res = await fetch('/api/get-products');
      
      if (!res.ok) {
        throw new Error(`Failed to fetch products: ${res.status}`);
      }

      // Check if response came from cache
      const cacheStatus = res.headers.get('X-Cache') || 'UNKNOWN';
      console.log(`📦 Cache status: ${cacheStatus}`);
      
      const data = await res.json();
      const now = new Date();
      
      // Process products and check expirations
      this.allProducts = (data || []).map(p => {
        let effectiveAdType = p.ad_type || 'free';
        let isFeatured = p.is_featured || false;
        let isBoosted = !!p.boosted_at;

        // Check if featured ad has expired
        if (p.featured_until) {
          const featuredExpiry = new Date(p.featured_until);
          if (now > featuredExpiry) {
            isFeatured = false;
            effectiveAdType = 'free';
          }
        }

        // Check if boosted ad has expired
        if (p.boosted_until) {
          const boostedExpiry = new Date(p.boosted_until);
          if (now > boostedExpiry) {
            isBoosted = false;
            if (!isFeatured) {
              effectiveAdType = 'free';
            }
          }
        }

        return {
          ...p,
          is_featured: isFeatured,
          is_boosted: isBoosted,
          ad_type: effectiveAdType,
          seller_name: p.users?.full_name || 'Unknown Seller',
          seller_avatar: p.users?.avatar_url || 'default-avatar.png',
          seller_verified: p.users?.is_verified || false,
          seller_last_active: p.users?.last_active || p.users?.created_at || null,
          seller_joined: p.users?.created_at || null
        };
      });

      this.products = this.allProducts;
      this.renderProducts(this.products);
      
      console.log(`✅ Loaded ${this.allProducts.length} products (${cacheStatus})`);
      
    } catch (err) {
      console.error('❌ Failed to load products:', err);
      const grid = document.getElementById('productGrid');
      if (grid) {
        grid.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #999;">
            <i class='bx bx-error' style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
            <p>Failed to load products. Please try again.</p>
          </div>
        `;
      }
    }
  }

  // 🔧 NEW: Sorting helper (verified first, then older account)
  sortByTrust(list) {
    return list.sort((a, b) => {
      // Verified sellers first
      if (a.seller_verified && !b.seller_verified) return -1;
      if (!a.seller_verified && b.seller_verified) return 1;

      // Then older account (earlier created_at) ranks higher
      const dateA = a.seller_joined ? new Date(a.seller_joined) : new Date(0);
      const dateB = b.seller_joined ? new Date(b.seller_joined) : new Date(0);
      return dateA - dateB; // ascending = older first
    });
  }

  renderProducts(list) {
    const grid = document.getElementById('productGrid');
    if (!grid) return;

    if (!list || list.length === 0) {
      grid.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #999;">
          <i class='bx bx-search-alt' style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
          <p>No products found</p>
        </div>
      `;
      return;
    }

    const now = new Date();

    // ✅ Separate products by ad type with expiration checking
    let featuredAds = list.filter(p => {
      if (p.is_featured) {
        if (p.featured_until) {
          return now <= new Date(p.featured_until);
        }
        return true;
      }
      return false;
    });
    
    let boostedAds = list.filter(p => {
      if (featuredAds.includes(p)) return false;
      
      if (p.is_boosted || p.boosted_at) {
        if (p.boosted_until) {
          return now <= new Date(p.boosted_until);
        }
        return true;
      }
      return false;
    });
    
    let freeAds = list.filter(p => 
      !featuredAds.includes(p) && !boostedAds.includes(p)
    );

    // ✅ Apply trust sorting within each group
    featuredAds = this.sortByTrust(featuredAds);
    boostedAds = this.sortByTrust(boostedAds);
    freeAds = this.sortByTrust(freeAds);

    console.log('Rendering:', {
      featured: featuredAds.length,
      boosted: boostedAds.length,
      free: freeAds.length
    });

    let html = '';

    // ✅ FEATURED ADS SECTION
    if (featuredAds.length > 0) {
      html += '<div class="section-header"><i class="bx bxs-star"></i> Featured Listings</div>';
      featuredAds.forEach((p) => {
        html += this.renderProductCard(p, 'featured');
      });
    }

    // ✅ BOOSTED ADS SECTION
    if (boostedAds.length > 0) {
      html += '<div class="section-header"><i class="bx bxs-bolt"></i> Boosted Listings</div>';
      boostedAds.forEach((p) => {
        html += this.renderProductCard(p, 'boosted');
      });
    }

    // ✅ FREE ADS SECTION
    if (freeAds.length > 0) {
      html += '<div class="section-header"><i class="bx bx-grid-alt"></i> All Listings</div>';
      html += '<div class="free-ads-grid">';
      freeAds.forEach((p) => {
        html += this.renderProductCard(p, 'free');
      });
      html += '</div>';
    }

    grid.innerHTML = html;
    initLazyImages();
    this.setupImageCarousels();
  }

  renderProductCard(p, adType = 'free') {
    const images = p.images && p.images.length > 0 ? p.images : ['placeholder.png'];
    const dotsHTML = images.length > 1 ? `
      <div class="image-dots">
        ${images.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('')}
      </div>
    ` : '';

    return `
      <div class="product-card ${adType}"
           data-id="${p.id}"
           data-type="${adType}"
           data-category="${p.category}"
           onclick='openProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
        <div class="card-image-carousel">
          <div class="card-images-scroll" data-card-id="${p.id}-${adType}">
            ${images.map(img => `
  <div class="card-image-item">
    <img 
      src="placeholder.png" 
      data-src="${img}" 
      alt="${p.name}" 
      class="lazy-img" 
      width="300" 
      height="300"
      loading="lazy"
      onerror="this.src='placeholder.png'; console.error('❌ [CARD] Image failed:', this.dataset.src);"
    >
  </div>
`).join('')}
          </div>
          ${p.seller_verified ? '<div class="verified-badge-card"><i class="bx bx-check"></i></div>' : ''}
          ${dotsHTML}
        </div>
        
        <div class="product-info">
          <p class="product-price">${this.formatPrice(p.price)}</p>
          <h3>${p.name}</h3>
          <p class="product-meta">📍 ${p.location || 'Location not set'}</p>
        </div>
      </div>
    `;
  }

  // ✅ IMPROVED IMAGE CAROUSEL WITH BETTER PERFORMANCE
  setupImageCarousels() {
    const carousels = document.querySelectorAll('.card-images-scroll');
    
    carousels.forEach(carousel => {
      let scrollTimeout = null;
      
      carousel.addEventListener('scroll', () => {
        // Clear previous timeout
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }
        
        // Wait for scrolling to stop
        scrollTimeout = setTimeout(() => {
          const scrollLeft = carousel.scrollLeft;
          const itemWidth = carousel.querySelector('.card-image-item')?.offsetWidth || 0;
          
          if (itemWidth === 0) return;
          
          const currentIndex = Math.round(scrollLeft / itemWidth);
          
          // Update dots
          const card = carousel.closest('.product-card');
          const dots = card?.querySelectorAll('.dot');
          if (dots) {
            dots.forEach((dot, i) => {
              dot.classList.toggle('active', i === currentIndex);
            });
          }
        }, 150);
      }, { passive: true });
    });
  }

  // ✅ FIXED: Always returns a value, uses created_at as fallback
  getLastActive(lastActive) {
    if (!lastActive) return '📅 Recently joined';
    
    const now = Date.now();
    const lastActiveTime = new Date(lastActive).getTime();
    const diffMs = now - lastActiveTime;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffMinutes < 5) return '🟢 Active now';
    if (diffMinutes < 60) return `🟡 Active ${diffMinutes} min ago`;
    if (diffHours === 1) return '🟡 Active 1 hour ago';
    if (diffHours < 24) return `🟡 Active ${diffHours} hours ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return '🟠 Active yesterday';
    if (diffDays < 7) return `🟠 Active ${diffDays} days ago`;
    if (diffDays < 30) return `⚪ Active ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
    
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `⚪ Active ${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    
    return '⚪ Last seen: 1+ year ago';
  }

  getTimeOnPlatform(joinedDate) {
    if (!joinedDate) return 'New to Tesatiki';
    
    const now = Date.now();
    const joinedTime = new Date(joinedDate).getTime();
    const diffMs = now - joinedTime;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 1) return '🆕 Joined today';
    if (diffDays === 1) return '🆕 Joined yesterday';
    if (diffDays < 7) return `🆕 Joined ${diffDays} days ago`;
    if (diffDays < 30) return `Member for ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''}`;
    
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `Member for ${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
    
    const diffYears = Math.floor(diffMonths / 12);
    const remainingMonths = diffMonths % 12;
    
    if (remainingMonths === 0) {
      return `Member for ${diffYears} year${diffYears > 1 ? 's' : ''}`;
    } else {
      return `Member for ${diffYears} year${diffYears > 1 ? 's' : ''} ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}`;
    }
  }

  formatPrice(value) {
    return new Intl.NumberFormat('en-UG', {
      style: 'currency',
      currency: 'UGX',
      maximumFractionDigits: 0
    }).format(value);
  }
}

// ================= PRODUCT MODAL =================
function openProduct(product) {
  const modal = document.getElementById('productModal');
  const content = document.getElementById('productContent');

  let fullNumber = product.phone || '';
  if (fullNumber) {
    if (fullNumber.startsWith('0')) {
      fullNumber = '256' + fullNumber.slice(1);
    } else if (fullNumber.startsWith('7')) {
      fullNumber = '256' + fullNumber;
    }
  }

  const images = product.images && product.images.length > 0 ? product.images : ['placeholder.png'];

  // Get last active and time on platform
  const lastActiveText = window.tesatiki.getLastActive(product.seller_last_active);
  const timeOnPlatform = window.tesatiki.getTimeOnPlatform(product.seller_joined);

  content.innerHTML = `
    <div class="modal-image-slider" id="modalImageSlider">
      ${images.map((img, index) => `
        <img 
          src="placeholder.png" 
          data-src="${img}" 
          alt="${product.name}" 
          data-index="${index}"
          style="width: 100%; height: auto; display: block;"
          onerror="this.src='placeholder.png'; console.error('❌ [MODAL] Image failed:', this.dataset.src);"
        >
      `).join('')}
    </div>

    ${images.length > 1 ? `
      <div class="modal-image-indicators">
        ${images.map((_, i) => `<div class="modal-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('')}
      </div>
    ` : ''}

    <div class="seller-profile-modal">
      <img src="${product.seller_avatar}" 
           alt="${product.seller_name}" 
           class="seller-avatar-modal"
           onerror="this.src='default-avatar.png'">
      <div class="seller-info-modal">
        <h3>
          ${product.seller_name}
          ${product.seller_verified ? '<i class="bx bxs-badge-check verified-icon-modal"></i>' : ''}
        </h3>
        <p class="seller-location-modal">📍 ${product.location || 'Location not set'}</p>
        <p class="seller-active-modal">${lastActiveText}</p>
        <p class="seller-platform-time">🕒 ${timeOnPlatform}</p>
      </div>
    </div>

    <div class="modal-details">
      <div class="modal-price">${window.tesatiki.formatPrice(product.price)}</div>
      <div class="modal-title">${product.name}</div>
      <p class="modal-meta"><i class='bx bx-package'></i> Condition: ${product.condition || 'Not specified'}</p>

      <div class="badges">
        ${product.installment ? '<span class="badge yes">💳 Installment Available</span>' : ''}
        ${product.negotiable ? '<span class="badge yes">💬 Negotiable</span>' : ''}
      </div>

      <div class="modal-desc">${product.description || 'No description provided.'}</div>

      ${fullNumber ? `
        <div class="contact-options">
          <a class="whatsapp-btn" href="https://wa.me/${fullNumber}" target="_blank">
            <i class='bx bxl-whatsapp' style="font-size: 20px;"></i>
            WhatsApp
          </a>
          <button class="show-contact-btn" id="showContactBtn">
            <i class='bx bx-phone' style="font-size: 18px;"></i>
            Call Seller
          </button>
        </div>
      ` : '<p style="color: #f44336; font-size: 14px; margin: 16px 0;">⚠️ Seller has not added contact</p>'}

      <div class="safety">
        <strong>⚠️ Safety Tips:</strong><br>
        Never pay in advance. Meet in a safe public place. Inspect the item before payment.
      </div>
    </div>
  `;

  // Setup contact button
  const showContactBtn = content.querySelector('#showContactBtn');
  if (showContactBtn) {
    let revealed = false;
    showContactBtn.addEventListener('click', () => {
      if (!revealed) {
        showContactBtn.innerHTML = `<i class='bx bx-phone' style="font-size: 18px;"></i> ${fullNumber}`;
        revealed = true;
      } else {
        window.location.href = `tel:${fullNumber}`;
      }
    });
  }

  // Load modal images with proper error handling
  console.log(`📸 [MODAL] Loading ${images.length} image(s)`);
  setTimeout(() => {
    const modalImages = content.querySelectorAll('[data-src]');
    modalImages.forEach((img, idx) => {
      const dataSrc = img.dataset.src;
      console.log(`📸 [MODAL] Loading image ${idx + 1}/${modalImages.length}: ${dataSrc}`);
      
      img.src = dataSrc;
      img.onerror = () => {
        console.error(`❌ [MODAL] Image ${idx + 1} failed to load: ${dataSrc}`);
        img.src = 'placeholder.png';
      };
      img.onload = () => {
        console.log(`✅ [MODAL] Image ${idx + 1} loaded: ${dataSrc}`);
      };
    });
  }, 50);

  // Setup image slider indicators
  if (images.length > 1) {
    const slider = content.querySelector('#modalImageSlider');
    const dots = content.querySelectorAll('.modal-dot');
    
    let scrollTimeout = null;
    slider.addEventListener('scroll', () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      
      scrollTimeout = setTimeout(() => {
        const scrollLeft = slider.scrollLeft;
        const itemWidth = slider.querySelector('img')?.offsetWidth || 0;
        if (itemWidth === 0) return;
        
        const currentIndex = Math.round(scrollLeft / itemWidth);
        
        dots.forEach((dot, i) => {
          dot.classList.toggle('active', i === currentIndex);
        });
      }, 100);
    }, { passive: true });
  }

  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
  console.log('✅ [MODAL] Opened');
}

function closeProduct() {
  document.getElementById('productModal').style.display = 'none';
  document.body.style.overflow = 'auto';
}

window.openProduct = openProduct;
window.closeProduct = closeProduct;

// ================= EXPIRE ADS ON FIRST VISIT =================
async function runExpireAdsIfNeeded() {
  try {
    const { data: settingsData, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .eq('key', 'last_expired_run');

    if (settingsError) {
      console.error('Failed to get last_expired_run:', settingsError);
      return;
    }

    let lastRun = null;

    if (settingsData && settingsData.length > 0) {
      lastRun = settingsData[0].value ? new Date(settingsData[0].value) : null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!lastRun || lastRun < today) {
      const { data, error } = await supabase.rpc('expire_ads');
      if (error) {
        console.error('Failed to run expire_ads:', error);
      } else {
        console.log('✅ Expired ads updated today');
      }

      if (settingsData && settingsData.length > 0) {
        await supabase
          .from('settings')
          .update({ value: new Date().toISOString() })
          .eq('key', 'last_expired_run');
      } else {
        await supabase
          .from('settings')
          .insert({ key: 'last_expired_run', value: new Date().toISOString() });
      }
    } else {
      console.log('Ads already expired today, skipping...');
    }
  } catch (err) {
    console.error('Error in runExpireAdsIfNeeded:', err);
  }
}

// ================= LAZY IMAGE LOADER =================
function initLazyImages() {
  const lazyImages = document.querySelectorAll(".lazy-img");
  console.log(`📸 [LAZY] Initializing lazy loading for ${lazyImages.length} images`);

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const dataSrc = img.dataset.src;
          console.log(`📸 [LAZY] Loading: ${dataSrc}`);
          
          img.src = dataSrc;
          img.onload = () => {
            img.classList.add("loaded");
            console.log(`✅ [LAZY] Loaded: ${dataSrc}`);
          };
          img.onerror = () => {
            console.error(`❌ [LAZY] Failed to load: ${dataSrc}`);
            console.error(`   Network tab shows request details.`);
            img.src = 'placeholder.png';
            img.classList.add('error');
          };
          obs.unobserve(img);
        }
      });
    }, { 
      rootMargin: '50px' // Start loading 50px before visible
    });

    lazyImages.forEach(img => observer.observe(img));
  } else {
    // Fallback for browsers without IntersectionObserver
    console.warn('⚠️ [LAZY] IntersectionObserver not supported, loading all images immediately');
    lazyImages.forEach(img => {
      const dataSrc = img.dataset.src;
      console.log(`📸 [LAZY] Loading (fallback): ${dataSrc}`);
      
      img.src = dataSrc;
      img.onload = () => {
        img.classList.add("loaded");
        console.log(`✅ [LAZY] Loaded (fallback): ${dataSrc}`);
      };
      img.onerror = () => {
        console.error(`❌ [LAZY] Failed (fallback): ${dataSrc}`);
        img.src = 'placeholder.png';
        img.classList.add('error');
      };
    });
  }
}

// ================= INITIALIZE =================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Tesatiki App Starting...');
  window.tesatiki = new TesatikiApp();
  runExpireAdsIfNeeded();

  // lazy-load product images after initial render
  setTimeout(initLazyImages, 500); // slight delay to ensure product cards exist
  
  console.log('✅ Tesatiki App Ready');
});
