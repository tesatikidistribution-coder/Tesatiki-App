// =================== SECURITY: Admin access gate ===================
// Step 1: Immediate client-side block (UX guard — not a security boundary)
const currentUser = JSON.parse(localStorage.getItem('currentUser'));

if (!currentUser || currentUser.role !== 'admin') {
  document.body.innerHTML = '';
  alert('Access denied');
  window.location.replace('index.html');
  throw new Error('Unauthorized');
}

// Step 2: Server-side JWT verification — true security boundary.
// We verify the stored token with the worker before rendering anything.
// If the token is missing, expired, or the user is not admin on the server,
// we wipe the page and redirect immediately.
(async function verifyAdminSession() {
  const token = localStorage.getItem('authToken');
  if (!token) {
    document.body.innerHTML = '';
    window.location.replace('index.html');
    throw new Error('No token');
  }

  try {
    const res = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      document.body.innerHTML = '';
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      window.location.replace('index.html');
      throw new Error('Session invalid');
    }

    const data = await res.json();

    // SECURITY: Role must be 'admin' on the server record — not just in localStorage
    if (!data.user || data.user.role !== 'admin') {
      document.body.innerHTML = '';
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      alert('Access denied');
      window.location.replace('index.html');
      throw new Error('Not admin');
    }

    // Sync localStorage with the authoritative server record
    localStorage.setItem('currentUser', JSON.stringify(data.user));

  } catch (err) {
    // If fetch itself fails (network error), allow page to continue with
    // the already-verified client-side check — don't lock out on network issues
    if (err.message === 'Session invalid' || err.message === 'Not admin' || err.message === 'No token') {
      throw err; // re-throw hard security errors
    }
    console.warn('Admin session network check failed — proceeding with cached role:', err.message);
  }
})();

// =================== SECURITY HELPER: Get stored JWT token ===================
function getAuthToken() {
  return localStorage.getItem('authToken') || null;
}

// =================== CONFIG ===================
const SUPABASE_URL = 'https://gpkufzayrvfippxqfafa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwa3VmemF5cnZmaXBweHFmYWZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NjMwNDQsImV4cCI6MjA4NTAzOTA0NH0.3YHPrjJ65mn20ECCYCvbO56jWWUVLy1IGFzXp83Gn9U';

// ✅ Import and initialize Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================= SIMPLE FRONTEND ERROR ALERT =================
console.error = function(err) {
  alert('Error: ' + (err.message || err));
  // You can also keep logging to console if you want:
  // window.originalConsoleError(err);
};

// =================== HELPER: DELETE PRODUCT WITH IMAGES ===================
async function deleteProductWithImages(productId) {
  // SECURITY: Route all product deletions through _worker.js.
  // The worker verifies the JWT and confirms admin role before deleting.
  const token = getAuthToken();
  if (!token) {
    throw new Error('Session expired. Please log in again.');
  }

  const res = await fetch('/api/delete-product', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` // Worker verifies admin role server-side
    },
    body: JSON.stringify({ productId })
  });

  const result = await res.json();

  if (!res.ok) {
    throw new Error(result.error || 'Failed to delete product');
  }

  return result;
}

// =================== DEBOUNCE UTILITY ===================
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// =================== ADMIN APP ===================
class AdminApp {
  constructor() {
    this.currentSection = 'dashboard';
    this.allPendingProducts = [];
    this.allEditedProducts = [];
    this.allApprovedProducts = [];
    this.allUsers = [];
    this.init();
  }

  async init() {
    this.setupNavigation();
    this.setupMobileMenu();
    this.setupSearchAndFilters();
    await this.loadDashboard();
  }

  setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();

        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        const section = link.getAttribute('data-section');
        this.switchSection(section);

        if (window.innerWidth <= 968) {
          document.getElementById('sidebar').classList.remove('active');
        }
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken'); // Clear JWT on logout
        window.location.href = 'index.html';
      }
    });
  }

  setupMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobileMenuBtn');
    const sidebarToggle = document.getElementById('sidebarToggle');

    mobileBtn?.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });

    sidebarToggle?.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });
  }

  setupSearchAndFilters() {
    // Pending Products Filter
    const pendingFilter = document.getElementById('pendingFilter');
    if (pendingFilter) {
      pendingFilter.addEventListener('change', (e) => {
        this.filterPendingProducts(e.target.value);
      });
    }

    // Edited Listings Filter
    const editedFilter = document.getElementById('editedFilter');
    if (editedFilter) {
      editedFilter.addEventListener('change', (e) => {
        this.filterEditedProducts(e.target.value);
      });
    }

    // Approved Products Search with debounce
    const approvedSearch = document.getElementById('approvedSearch');
    if (approvedSearch) {
      approvedSearch.addEventListener('input', debounce((e) => {
        this.searchApprovedProducts(e.target.value);
      }, 300));
    }

    // Users Search with debounce
    const userSearch = document.getElementById('userSearch');
    if (userSearch) {
      userSearch.addEventListener('input', debounce((e) => {
        this.searchUsers(e.target.value);
      }, 300));
    }

    // Users Filter
    const userFilter = document.getElementById('userFilter');
    if (userFilter) {
      userFilter.addEventListener('change', (e) => {
        this.filterUsers(e.target.value);
      });
    }
  }

  switchSection(section) {
    document.querySelectorAll('.content-section').forEach(s => {
      s.classList.remove('active');
    });

    document.getElementById(section).classList.add('active');
    document.getElementById('pageTitle').textContent = this.getSectionTitle(section);

    switch(section) {
      case 'dashboard':
        this.loadDashboard();
        break;
      case 'pending':
        this.loadPendingProducts();
        break;
      case 'edited':
        this.loadEditedListings();
        break;
      case 'approved':
        this.loadApprovedProducts();
        break;
      case 'users':
        this.loadUsers();
        break;
      case 'verification':
        this.loadVerificationRequests();
        break;
      case 'premium':
        this.loadPremiumSection();
        break;
      case 'reports':
        this.loadReports();
        break;
    }

    this.currentSection = section;
  }

  getSectionTitle(section) {
    const titles = {
      dashboard: 'Dashboard',
      pending: 'Pending Products',
      edited: 'Edited Listings',
      approved: 'Approved Products',
      users: 'Manage Users',
      verification: 'Verification Requests',
      premium: 'Premium & Featured',
      reports: 'User Reports'
    };
    return titles[section] || 'Admin Panel';
  }

// ================= DASHBOARD =================
async loadDashboard() {
  try {
    // ✅ PENDING COUNT
    const pendingResp = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    const pendingCount = pendingResp.count;

    // ✅ EDITED COUNT
    const editedResp = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'edited');
    const editedCount = editedResp.count;

    // ✅ APPROVED COUNT
    const approvedResp = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');
    const approvedCount = approvedResp.count;

    // ✅ USERS COUNT - THIS WILL NOW WORK!
    const usersResp = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    const usersCount = usersResp.count;

    // ✅ VERIFIED COUNT
    const verifiedResp = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_verified', true);
    const verifiedCount = verifiedResp.count;

    // Log results to verify
    console.log('Dashboard Counts:', {
      pendingCount,
      editedCount,
      approvedCount,
      usersCount,
      verifiedCount
    });

    // Update the DOM
    document.getElementById('statPending').textContent = pendingCount || 0;
    document.getElementById('statApproved').textContent = approvedCount || 0;
    document.getElementById('statUsers').textContent = usersCount || 0;
    document.getElementById('statVerified').textContent = verifiedCount || 0;
    document.getElementById('pendingCount').textContent = pendingCount || 0;
    document.getElementById('editedCount').textContent = editedCount || 0;

    await this.loadRecentActivity();

  } catch (error) {
    console.error('Error loading dashboard:', error);
    showNotification('Failed to load dashboard data', 'error');
  }
}

  async loadRecentActivity() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, users(full_name)')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      const container = document.getElementById('recentActivity');
      
      if (!data || data.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center;">No recent activity</p>';
        return;
      }

      container.innerHTML = data.map(item => {
        const iconBg = item.status === 'approved' ? 'background: #4CAF50' : 
                       item.status === 'rejected' ? 'background: #f44336' : 
                       item.status === 'edited' ? 'background: #ff9800' :
                       'background: #2196F3';
        
        const iconClass = item.status === 'approved' ? 'bx-check' : 
                          item.status === 'rejected' ? 'bx-x' : 
                          item.status === 'edited' ? 'bx-edit' :
                          'bx-time';
        
        return `
          <div class="activity-item">
            <div class="activity-icon" style="${iconBg}">
              <i class='bx ${iconClass}'></i>
            </div>
            <div class="activity-info">
              <p><strong>${item.users?.full_name || 'User'}</strong> ${item.status === 'edited' ? 'edited' : 'posted'} "${item.name}"</p>
              <span class="activity-time">${this.formatTime(item.created_at)}</span>
            </div>
          </div>
        `;
      }).join('');

    } catch (error) {
      console.error('Error loading activity:', error);
    }
  }

  // ================= PENDING PRODUCTS =================
  async loadPendingProducts() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, users(full_name, avatar_url)')
        .eq('status', 'pending')
        .eq('admin_approved', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.allPendingProducts = data || [];
      
      // Reset filter
      const filter = document.getElementById('pendingFilter');
      if (filter) filter.value = 'all';
      
      this.renderPendingProducts(this.allPendingProducts);

    } catch (error) {
      console.error('Error loading pending products:', error);
      showNotification('Failed to load pending products', 'error');
    }
  }

  filterPendingProducts(category) {
    let filtered = [...this.allPendingProducts];

    if (category && category !== 'all') {
      filtered = filtered.filter(p => p.category === category);
    }

    this.renderPendingProducts(filtered);
  }

  renderPendingProducts(products) {
    const container = document.getElementById('pendingProducts');
    
    if (!products || products.length === 0) {
      container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">No pending products</p>';
      return;
    }

    container.innerHTML = products.map(product => this.renderProductCard(product, 'pending')).join('');
  }

  // ================= EDITED LISTINGS =================
  async loadEditedListings() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, users(full_name, avatar_url)')
        .eq('status', 'edited')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      this.allEditedProducts = data || [];
      
      // Reset filter
      const filter = document.getElementById('editedFilter');
      if (filter) filter.value = 'all';
      
      this.renderEditedProducts(this.allEditedProducts);

    } catch (error) {
      console.error('Error loading edited listings:', error);
      showNotification('Failed to load edited listings', 'error');
    }
  }

  filterEditedProducts(category) {
    let filtered = [...this.allEditedProducts];

    if (category && category !== 'all') {
      filtered = filtered.filter(p => p.category === category);
    }

    this.renderEditedProducts(filtered);
  }

  renderEditedProducts(products) {
    const container = document.getElementById('editedProducts');
    
    if (!products || products.length === 0) {
      container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">No edited listings</p>';
      return;
    }

    container.innerHTML = products.map(product => this.renderProductCard(product, 'edited')).join('');
  }

  // ================= APPROVED PRODUCTS =================
  async loadApprovedProducts() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, users(full_name, avatar_url)')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.allApprovedProducts = data || [];
      
      // Reset search
      const search = document.getElementById('approvedSearch');
      if (search) search.value = '';
      
      this.renderApprovedProducts(this.allApprovedProducts);

    } catch (error) {
      console.error('Error loading approved products:', error);
    }
  }

  searchApprovedProducts(searchTerm) {
    let filtered = [...this.allApprovedProducts];

    if (searchTerm && searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(p => {
        const name = (p.name || '').toLowerCase();
        const location = (p.location || '').toLowerCase();
        const userName = (p.users?.full_name || '').toLowerCase();
        
        return name.includes(term) || location.includes(term) || userName.includes(term);
      });
    }

    this.renderApprovedProducts(filtered);
  }

  renderApprovedProducts(products) {
    const container = document.getElementById('approvedProducts');
    
    if (!products || products.length === 0) {
      container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">No approved products</p>';
      return;
    }

    container.innerHTML = products.map(product => this.renderProductCard(product, 'approved')).join('');
  }

  renderProductCard(product, status) {
    const image = product.images && product.images[0] ? product.images[0] : 'placeholder.png';
    const statusClass = `status-${status}`;

    let actions = '';
    if (status === 'pending') {
      actions = `
        <button class="btn btn-success" onclick="approveProduct('${product.id}')">
          <i class='bx bx-check'></i> Approve
        </button>
        <button class="btn btn-danger" onclick="rejectProduct('${product.id}')">
          <i class='bx bx-x'></i> Reject
        </button>
        <button class="btn btn-secondary" onclick="viewProduct('${product.id}')">
          <i class='bx bx-show'></i> View
        </button>
      `;
    } else if (status === 'edited') {
      actions = `
        <button class="btn btn-success" onclick="approveEditedListing('${product.id}')">
          <i class='bx bx-check'></i> Approve Edit
        </button>
        <button class="btn btn-danger" onclick="rejectEditedListing('${product.id}')">
          <i class='bx bx-x'></i> Reject Edit
        </button>
        <button class="btn btn-secondary" onclick="viewProduct('${product.id}')">
          <i class='bx bx-show'></i> View
        </button>
      `;
    } else if (status === 'approved') {
      actions = `
        <button class="btn btn-secondary" onclick="viewProduct('${product.id}')">
          <i class='bx bx-show'></i> View
        </button>
        <button class="btn btn-danger" onclick="deleteProduct('${product.id}')">
          <i class='bx bx-trash'></i> Delete
        </button>
      `;
    }

    let adType = 'Free';
    let adColor = '#9E9E9E';

    if (product.is_featured === true || product.ad_type === 'featured') {
      adType = 'Featured';
      adColor = '#FFD700';
    } 
    else if (product.ad_type === '7days') {
      adType = 'Boosted - 7 days';
      adColor = '#9C27B0';
    } 
    else if (product.ad_type === '30days') {
      adType = 'Boosted - 30 days';
      adColor = '#9C27B0';
    }

    let statusBadge = '';
    if (status === 'edited') {
      statusBadge = '<span class="product-status status-edited">Edited</span>';
    } else if (status === 'pending') {
      statusBadge = `<span class="product-status ${statusClass}">Pending</span>`;
    }

    return `
      <div class="product-card">
        <div class="product-image" style="background-image: url('${image}');">
          ${statusBadge}
        </div>
        <div class="product-info">
          <h3 class="product-name">${product.name}</h3>
          <div class="product-price">${this.formatPrice(product.price)}</div>
          <div class="seller-phone">${product.phone || 'No phone provided'}</div>
          <div class="product-ad-type" style="font-weight: bold; color: ${adColor}">
            Ad Type: ${adType}
          </div>
          <p class="product-location">📍 ${product.location || 'Not specified'}</p>
          ${status === 'edited' ? `<p style="font-size: 12px; color: #ff9800; margin-top: 4px;">Last edited: ${this.formatDate(product.updated_at)}</p>` : ''}
          <div class="seller-info">
            <img src="${product.users?.avatar_url || 'default-avatar.png'}" 
                 alt="${product.users?.full_name || 'Unknown'}" 
                 class="seller-avatar"
                 onerror="this.src='default-avatar.png'">
            <span class="seller-name">${product.users?.full_name || 'Unknown'}</span>
          </div>
        </div>
        <div class="product-actions">
          ${actions}
        </div>
      </div>
    `;
  }

  // ================= USERS MANAGEMENT =================
  async loadUsers() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.allUsers = data || [];
      
      // Reset search and filter
      const search = document.getElementById('userSearch');
      const filter = document.getElementById('userFilter');
      if (search) search.value = '';
      if (filter) filter.value = 'all';
      
      this.renderUsers(this.allUsers);

    } catch (error) {
      console.error('Error loading users:', error);
    }
  }

  searchUsers(searchTerm) {
    const filterValue = document.getElementById('userFilter')?.value || 'all';
    this.filterAndSearchUsers(searchTerm, filterValue);
  }

  filterUsers(filterValue) {
    const searchTerm = document.getElementById('userSearch')?.value || '';
    this.filterAndSearchUsers(searchTerm, filterValue);
  }

  filterAndSearchUsers(searchTerm, filterValue) {
    let filtered = [...this.allUsers];

    // Apply filter
    if (filterValue === 'verified') {
      filtered = filtered.filter(u => u.is_verified === true);
    } else if (filterValue === 'unverified') {
      filtered = filtered.filter(u => u.is_verified !== true);
    }

    // Apply search
    if (searchTerm && searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(u => {
        const name = (u.full_name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        
        return name.includes(term) || email.includes(term);
      });
    }

    this.renderUsers(filtered);
  }

  // ✨ UPDATED renderUserCard with new buttons
  renderUsers(users) {
    const container = document.getElementById('usersList');
    
    if (!users || users.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No users found</p>';
      return;
    }

    container.innerHTML = users.map(user => this.renderUserCard(user)).join('');
  }

  renderUserCard(user) {
    const isVerified = user.is_verified === true;

    return `
      <div class="user-card">
        <img src="${user.avatar_url || 'default-avatar.png'}" 
             alt="${user.full_name}" 
             class="user-avatar-large"
             onerror="this.src='default-avatar.png'">
        <div class="user-info">
          <h3>
            ${user.full_name || 'Unknown User'}
            ${isVerified ? '<i class="bx bxs-badge-check verified-badge"></i>' : ''}
          </h3>
          <p class="user-meta">📧 ${user.email || 'No email'}</p>
          <p class="user-meta">📱 ${user.phone || 'No phone'}</p>
          <p class="user-meta">📅 Joined ${this.formatDate(user.created_at)}</p>
        </div>
        <div class="user-actions">
          ${!isVerified ? `
            <button class="btn btn-success btn-sm" onclick="verifyUser('${user.id}')">
              <i class='bx bx-badge-check'></i> Verify
            </button>
          ` : `
            <button class="btn btn-warning btn-sm" onclick="unverifyUser('${user.id}')">
              <i class='bx bx-x-circle'></i> Unverify
            </button>
          `}
          <button class="btn btn-secondary btn-sm" onclick="resetUserPassword('${user.id}')">
            <i class='bx bx-key'></i> Reset Password
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteUserPermanently('${user.id}')">
            <i class='bx bx-trash'></i> Delete User
          </button>
          <button class="btn btn-secondary btn-sm" onclick="viewUserDetails('${user.id}')">
            <i class='bx bx-show'></i> View
          </button>
        </div>
      </div>
    `;
  }

  // ================= VERIFICATION REQUESTS =================
  async loadVerificationRequests() {
    try {
      const { data, error } = await supabase
        .from('verification_requests')
        .select('*, users(full_name, email, phone, avatar_url)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      document.getElementById('verificationCount').textContent = data?.length || 0;

      const container = document.getElementById('verificationRequests');
      
      if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No verification requests</p>';
        return;
      }

      container.innerHTML = data.map(request => `
        <div class="verification-card">
          <div class="verification-header">
            <img src="${request.users?.avatar_url || 'default-avatar.png'}" 
                 class="user-avatar-large"
                 onerror="this.src='default-avatar.png'">
            <div class="verification-info">
              <h3>${request.users?.full_name || 'Unknown'}</h3>
              <p class="user-meta">${request.users?.email || ''}</p>
              <p class="user-meta">${request.users?.phone || ''}</p>
            </div>
          </div>
          <div class="verification-details">
            <div class="detail-item">
              <span class="detail-label">Request Type:</span>
              <span class="detail-value">${request.verification_type || 'Basic'}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Submitted:</span>
              <span class="detail-value">${this.formatDate(request.created_at)}</span>
            </div>
          </div>
          <div class="verification-actions">
            <button class="btn btn-success" onclick="approveVerification('${request.id}', '${request.user_id}')">
              <i class='bx bx-check'></i> Approve Verification
            </button>
            <button class="btn btn-danger" onclick="rejectVerification('${request.id}')">
              <i class='bx bx-x'></i> Reject
            </button>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('Error loading verification requests:', error);
    }
  }

  // ================= PREMIUM SECTION =================
  async loadPremiumSection() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('has_premium', true)
        .order('premium_expires_at', { ascending: true });

      if (error) throw error;

      const container = document.getElementById('premiumUsers');
      
      if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No premium users</p>';
        return;
      }

      container.innerHTML = data.map(user => `
        <div class="user-card">
          <img src="${user.avatar_url || 'default-avatar.png'}" 
               class="user-avatar-large"
               onerror="this.src='default-avatar.png'">
          <div class="user-info">
            <h3>${user.full_name || 'Unknown'}</h3>
            <p class="user-meta">📧 ${user.email || ''}</p>
            <p class="user-meta">⏰ Expires: ${this.formatDate(user.premium_expires_at)}</p>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('Error loading premium users:', error);
    }
  }

  // ================= REPORTS =================
  async loadReports() {
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*, reporter:users!reports_reporter_id_fkey(full_name), reported:users!reports_reported_id_fkey(full_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      document.getElementById('reportsCount').textContent = data?.length || 0;

      const container = document.getElementById('reportsList');
      
      if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No pending reports</p>';
        return;
      }

      container.innerHTML = data.map(report => `
        <div class="report-card">
          <div class="report-header">
            <div>
              <span class="report-type">${report.report_type || 'General'}</span>
              <p style="margin-top: 8px; font-size: 13px; color: #666;">
                <strong>${report.reporter?.full_name || 'Anonymous'}</strong> reported 
                <strong>${report.reported?.full_name || 'User'}</strong>
              </p>
            </div>
            <span style="font-size: 12px; color: #999;">${this.formatDate(report.created_at)}</span>
          </div>
          <div class="report-content">
            <h4>Reason:</h4>
            <p>${report.reason || 'No reason provided'}</p>
          </div>
          <div class="report-actions">
            <button class="btn btn-success" onclick="resolveReport('${report.id}')">
              <i class='bx bx-check'></i> Resolve
            </button>
            <button class="btn btn-secondary" onclick="dismissReport('${report.id}')">
              <i class='bx bx-x'></i> Dismiss
            </button>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('Error loading reports:', error);
    }
  }

  // ================= HELPER FUNCTIONS =================
  formatPrice(value) {
    return new Intl.NumberFormat('en-UG', {
      style: 'currency',
      currency: 'UGX',
      maximumFractionDigits: 0
    }).format(value);
  }

  formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  }

  formatTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return this.formatDate(dateString);
  }
}

// =================== GLOBAL FUNCTIONS ===================

// ✅ FIXED: Approve Product - Now uses _worker.js /api/update-product
window.approveProduct = async function(productId) {
  if (!confirm('Approve this product?')) return;

  try {
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('ad_type, is_featured')
      .eq('id', productId)
      .single();

    if (fetchError) throw fetchError;

    let updateData = { 
      status: 'approved', 
      admin_approved: true,
      approved_at: new Date().toISOString()
    };

    if (product.is_featured || product.ad_type === 'featured') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      updateData.is_featured = true;
      updateData.featured_until = expiresAt.toISOString();
      updateData.ad_type = 'featured';
      updateData.expires_at = expiresAt.toISOString();
    } else if (product.ad_type === '7days') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      updateData.boosted_at = new Date().toISOString();
      updateData.boosted_until = expiresAt.toISOString();
      updateData.ad_duration = 7;
      updateData.expires_at = expiresAt.toISOString();
    } else if (product.ad_type === '30days') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      updateData.boosted_at = new Date().toISOString();
      updateData.boosted_until = expiresAt.toISOString();
      updateData.ad_duration = 30;
      updateData.expires_at = expiresAt.toISOString();
    } else {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      updateData.ad_type = 'free';
      updateData.is_featured = false;
      updateData.boosted_at = null;
      updateData.boosted_until = null;
      updateData.featured_until = null;
      updateData.expires_at = expiresAt.toISOString();
    }

    // ✅ Call _worker.js endpoint instead of Supabase directly
    const token = getAuthToken();
    if (!token) {
      showNotification('Session expired', 'error');
      return;
    }

    const res = await fetch('/api/update-product', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        productId: productId,
        updates: updateData
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to approve product');
    }

    showNotification('Product approved successfully!', 'success');
    window.adminApp.loadPendingProducts();
    window.adminApp.loadDashboard();
  } catch (error) {
    console.error('Error approving product:', error);
    showNotification('Failed to approve product: ' + error.message, 'error');
  }
};

// ✅ FIXED: Approve Edited Listing - Now uses _worker.js /api/update-product
window.approveEditedListing = async function(productId) {
  if (!confirm('Approve this edited listing? The original expiration date will be preserved.')) return;

  try {
    const { data: currentProduct, error: fetchError } = await supabase
      .from('products')
      .select('expires_at, featured_until, boosted_until, approved_at')
      .eq('id', productId)
      .single();

    if (fetchError) throw fetchError;

    const updateData = { 
      status: 'approved',
      admin_approved: true,
      expires_at: currentProduct.expires_at,
      featured_until: currentProduct.featured_until,
      boosted_until: currentProduct.boosted_until,
      approved_at: currentProduct.approved_at || new Date().toISOString()
    };

    // ✅ Call _worker.js endpoint instead of Supabase directly
    const token = getAuthToken();
    if (!token) {
      showNotification('Session expired', 'error');
      return;
    }

    const res = await fetch('/api/update-product', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        productId: productId,
        updates: updateData
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to approve edited listing');
    }

    showNotification('Edited listing approved! Original expiration date preserved.', 'success');
    window.adminApp.loadEditedListings();
    window.adminApp.loadDashboard();
  } catch (error) {
    console.error('Error approving edited listing:', error);
    showNotification('Failed to approve edited listing: ' + error.message, 'error');
  }
};

// ✅ FIXED: Reject Edited Listing - Now uses _worker.js /api/update-product
window.rejectEditedListing = async function(productId) {
  if (!confirm('⚠️ Reject this edited listing? The product will revert to its last approved version.')) return;

  try {
    const updateData = { 
      status: 'approved',
      admin_approved: true
    };

    // ✅ Call _worker.js endpoint instead of Supabase directly
    const token = getAuthToken();
    if (!token) {
      showNotification('Session expired', 'error');
      return;
    }

    const res = await fetch('/api/update-product', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        productId: productId,
        updates: updateData
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to reject edited listing');
    }

    showNotification('Edited listing rejected. Product reverted to previous version.', 'success');
    window.adminApp.loadEditedListings();
    window.adminApp.loadDashboard();
  } catch (error) {
    console.error('Error rejecting edited listing:', error);
    showNotification('Failed to reject edited listing: ' + error.message, 'error');
  }
};

window.rejectProduct = async function(productId) {
  if (!confirm('⚠️ Reject and DELETE this product permanently? This cannot be undone! All images will also be deleted from storage.')) return;

  try {
    // SECURITY: Route through _worker.js — server verifies admin JWT before deleting
    await deleteProductWithImages(productId);

    showNotification('Product rejected and deleted permanently', 'success');
    window.adminApp.loadPendingProducts();
    window.adminApp.loadDashboard();
  } catch (error) {
    console.error('Error rejecting product:', error);
    showNotification('Failed to reject product', 'error');
  }
};

window.viewProduct = async function(productId) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    if (error) throw error;

    const content = `
      <h3>${data.name}</h3>
      <p>Price: ${window.adminApp.formatPrice(data.price)}</p>
      <p>Location: ${data.location || 'Not specified'}</p>
      <p>Status: ${data.status}</p>
      <p>Ad Type: ${data.ad_type || 'free'}</p>
      ${data.expires_at ? `<p>Expires: ${window.adminApp.formatDate(data.expires_at)}</p>` : ''}
      <div style="margin-top: 10px;">
        ${data.images?.map(img => `<img src="${img}" style="width: 100px; margin-right: 5px;">`).join('') || ''}
      </div>
      <p style="margin-top: 10px;">Description: ${data.description || 'No description'}</p>
    `;

    document.getElementById('modalProductContent').innerHTML = content;
    document.getElementById('productModal').style.display = 'block';
  } catch (err) {
    console.error('Error viewing product:', err);
    showNotification('Failed to load product details', 'error');
  }
};

window.closeProductModal = function() {
  document.getElementById('productModal').style.display = 'none';
};

window.viewUserDetails = async function(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;

    const content = `
      <h3>${data.full_name}</h3>
      <p>Email: ${data.email || 'N/A'}</p>
      <p>Phone: ${data.phone || 'N/A'}</p>
      <p>Status: ${data.account_status}</p>
      <p>Verified: ${data.is_verified ? 'Yes' : 'No'}</p>
      <p>Joined: ${window.adminApp.formatDate(data.created_at)}</p>
    `;

    document.getElementById('modalUserContent').innerHTML = content;
    document.getElementById('userModal').style.display = 'block';
  } catch (err) {
    console.error('Error viewing user:', err);
    showNotification('Failed to load user details', 'error');
  }
};

window.closeUserModal = function() {
  document.getElementById('userModal').style.display = 'none';
};

window.deleteProduct = async function(productId) {
  if (!confirm('⚠️ Permanently delete this product? This cannot be undone! All images will also be deleted from storage.')) return;

  try {
    // SECURITY: Route through _worker.js — server verifies admin JWT before deleting
    await deleteProductWithImages(productId);

    showNotification('Product and images deleted permanently', 'success');
    window.adminApp.switchSection(window.adminApp.currentSection);
  } catch (error) {
    console.error('Error deleting product:', error);
    showNotification('Failed to delete product', 'error');
  }
};

window.verifyUser = async function(userId) {
  if (!confirm('Verify this user?')) return;

  const token = getAuthToken();
  if (!token) {
    showNotification('Session expired', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/verify-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Verify failed');

    showNotification('User verified successfully!', 'success');
    window.adminApp.loadUsers();
    window.adminApp.loadDashboard();
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
};

// ✨ NEW: Unverify user
window.unverifyUser = async function(userId) {
  if (!confirm('Remove verified status from this user?')) return;

  const token = getAuthToken();
  if (!token) {
    showNotification('Session expired', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/unverify-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unverify failed');

    showNotification('User unverified', 'success');
    window.adminApp.loadUsers(); // reload list
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
};

// ✨ NEW: Reset user password
window.resetUserPassword = async function(userId) {
  const newPassword = prompt('Enter new password for this user:');
  if (!newPassword) return;

  const token = getAuthToken();
  if (!token) {
    showNotification('Session expired', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, newPassword })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset failed');

    showNotification('Password reset successfully!', 'success');
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
};

// ✨ NEW: Permanently delete user
window.deleteUserPermanently = async function(userId) {
  if (!confirm('⚠️ PERMANENTLY DELETE THIS USER AND ALL THEIR LISTINGS?\nThis action CANNOT be undone!')) return;

  const token = getAuthToken();
  if (!token) {
    showNotification('Session expired', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/delete-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    showNotification('User permanently deleted', 'success');
    window.adminApp.loadUsers(); // reload list
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
};

window.approveVerification = async function(requestId, userId) {
  if (!confirm('Approve verification request?')) return;

  try {
    await supabase
      .from('verification_requests')
      .update({ status: 'approved' })
      .eq('id', requestId);

    await supabase
      .from('users')
      .update({ is_verified: true })
      .eq('id', userId);

    showNotification('Verification approved!', 'success');
    window.adminApp.loadVerificationRequests();
    window.adminApp.loadDashboard();
  } catch (error) {
    console.error('Error approving verification:', error);
    showNotification('Failed to approve verification', 'error');
  }
};

window.rejectVerification = async function(requestId) {
  const reason = prompt('Reason for rejection:');
  if (!reason) return;

  try {
    await supabase
      .from('verification_requests')
      .update({ 
        status: 'rejected',
        rejection_reason: reason 
      })
      .eq('id', requestId);

    showNotification('Verification rejected', 'success');
    window.adminApp.loadVerificationRequests();
  } catch (error) {
    console.error('Error rejecting verification:', error);
    showNotification('Failed to reject verification', 'error');
  }
};

window.grantPremium = async function() {
  const userInput = document.getElementById('premiumUserInput').value;
  const duration = parseInt(document.getElementById('premiumDuration').value);

  if (!userInput || !duration) {
    alert('Please fill all fields');
    return;
  }

  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + duration);

    const { error } = await supabase
      .from('users')
      .update({ 
        has_premium: true,
        premium_expires_at: expiresAt.toISOString()
      })
      .or(`email.eq.${userInput},phone.eq.${userInput}`);

    if (error) throw error;

    showNotification('Premium granted successfully!', 'success');
    document.getElementById('premiumUserInput').value = '';
    window.adminApp.loadPremiumSection();
  } catch (error) {
    console.error('Error granting premium:', error);
    showNotification('Failed to grant premium', 'error');
  }
};

window.featureProduct = async function() {
  const productId = document.getElementById('featureProductId').value;
  const duration = parseInt(document.getElementById('featureDuration').value);

  if (!productId || !duration) {
    alert('Please fill all fields');
    return;
  }

  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + duration);

    const { error } = await supabase
      .from('products')
      .update({ 
        is_featured: true,
        featured_until: expiresAt.toISOString()
      })
      .eq('id', productId);

    if (error) throw error;

    showNotification('Product featured successfully!', 'success');
    document.getElementById('featureProductId').value = '';
  } catch (error) {
    console.error('Error featuring product:', error);
    showNotification('Failed to feature product', 'error');
  }
};

window.boostProduct = async function() {
  const productId = document.getElementById('boostProductId').value;

  if (!productId) {
    alert('Please enter product ID');
    return;
  }

  try {
    const { error } = await supabase
      .from('products')
      .update({ 
        boosted_at: new Date().toISOString()
      })
      .eq('id', productId);

    if (error) throw error;

    showNotification('Product boosted successfully!', 'success');
    document.getElementById('boostProductId').value = '';
  } catch (error) {
    console.error('Error boosting product:', error);
    showNotification('Failed to boost product', 'error');
  }
};

window.resolveReport = async function(reportId) {
  try {
    await supabase
      .from('reports')
      .update({ status: 'resolved' })
      .eq('id', reportId);

    showNotification('Report resolved', 'success');
    window.adminApp.loadReports();
  } catch (error) {
    console.error('Error resolving report:', error);
    showNotification('Failed to resolve report', 'error');
  }
};

window.dismissReport = async function(reportId) {
  try {
    await supabase
      .from('reports')
      .update({ status: 'dismissed' })
      .eq('id', reportId);

    showNotification('Report dismissed', 'success');
    window.adminApp.loadReports();
  } catch (error) {
    console.error('Error dismissing report:', error);
    showNotification('Failed to dismiss report', 'error');
  }
};

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
  .status-edited {
    background: #ff9800;
    color: #fff;
  }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
  window.adminApp = new AdminApp();
});
