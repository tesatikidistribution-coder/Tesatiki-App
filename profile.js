import { supabase } from './api.js';

// ================= SECURITY CONSTANTS =================
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_REQUIREMENTS = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  numbers: /[0-9]/,
  minLength: PASSWORD_MIN_LENGTH
};

// ================= DOM ELEMENTS =================
const profilePic = document.getElementById('profilePic');
const profileName = document.getElementById('profileName');
const profileNameText = document.getElementById('profileNameText');
const profileVerifiedBadge = document.getElementById('profileVerifiedBadge');
const profilePhone = document.getElementById('profilePhone');
const btnEditProfile = document.getElementById('btnEditProfile');
const btnLogout = document.getElementById('btnLogout');
const profileView = document.querySelector('.profile-view');
const profileEdit = document.getElementById('profileEdit');
const editForm = document.getElementById('editForm');
const editName = document.getElementById('editName');
const editPhone = document.getElementById('editPhone');
const editCurrentPassword = document.getElementById('editCurrentPassword');
const editPassword = document.getElementById('editPassword');
const editPasswordConfirm = document.getElementById('editPasswordConfirm');
const editPic = document.getElementById('editPic');
const btnSave = document.getElementById('btnSave');
const btnCancel = document.getElementById('btnCancel');
const listingsContainer = document.getElementById('listingsContainer');
const passwordStrengthMeter = document.getElementById('passwordStrengthMeter');
const passwordStrengthText = document.getElementById('passwordStrengthText');
const passwordStrengthContainer = document.getElementById('passwordStrengthContainer');

let currentUser = null;

// ================= JWT TOKEN MANAGEMENT =================
/**
 * FIX: Get JWT token from localStorage
 * REASON: _worker.js uses Bearer token authentication for all protected endpoints
 */
function getAuthToken() {
  return localStorage.getItem('authToken') || null;
}

/**
 * FIX: Store JWT token securely
 * REASON: Token must persist across page reloads for session continuity
 */
function setAuthToken(token) {
  localStorage.setItem('authToken', token);
}

// ================= PASSWORD VALIDATION =================
/**
 * FIX: Validate password against _worker.js requirements
 * REASON: Must match server-side validation (8+ chars, uppercase, lowercase, numbers)
 */
function validatePassword(password) {
  const errors = [];

  if (!password) {
    return { valid: false, errors: ['Password is required'] };
  }

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Minimum ${PASSWORD_MIN_LENGTH} characters`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Maximum ${PASSWORD_MAX_LENGTH} characters`);
  }

  if (!PASSWORD_REQUIREMENTS.uppercase.test(password)) {
    errors.push('At least one uppercase letter (A-Z)');
  }

  if (!PASSWORD_REQUIREMENTS.lowercase.test(password)) {
    errors.push('At least one lowercase letter (a-z)');
  }

  if (!PASSWORD_REQUIREMENTS.numbers.test(password)) {
    errors.push('At least one number (0-9)');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * FIX: Real-time password strength meter
 * REASON: Provides user feedback on password quality
 */
function updatePasswordStrength(password) {
  if (!password) {
    if (passwordStrengthContainer) passwordStrengthContainer.style.display = 'none';
    return;
  }

  if (passwordStrengthContainer) passwordStrengthContainer.style.display = 'block';

  let strength = 0;
  const maxChecks = 5;

  // Length checks
  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;

  // Character variety checks
  if (PASSWORD_REQUIREMENTS.uppercase.test(password)) strength++;
  if (PASSWORD_REQUIREMENTS.lowercase.test(password)) strength++;
  if (PASSWORD_REQUIREMENTS.numbers.test(password)) strength++;

  const percentage = (strength / maxChecks) * 100;
  let strengthText = 'Weak';
  let strengthClass = 'strength-weak';

  if (strength >= 4) {
    strengthText = 'Strong';
    strengthClass = 'strength-strong';
  } else if (strength >= 3) {
    strengthText = 'Medium';
    strengthClass = 'strength-medium';
  }

  if (passwordStrengthMeter) {
    passwordStrengthMeter.style.width = percentage + '%';
    passwordStrengthMeter.className = `password-strength-meter ${strengthClass}`;
  }

  if (passwordStrengthText) {
    passwordStrengthText.textContent = `Strength: ${strengthText}`;
    passwordStrengthText.className = `password-strength-text ${strengthClass}`;
  }
}

// ================= PHONE VALIDATION =================
/**
 * FIX: Validate phone against _worker.js regex: ^\+2567[0-9]{8}$
 * REASON: Must match server-side sanitizePhone() validation
 */
function validatePhone(phone) {
  const cleaned = phone.trim().replace(/\s/g, '');
  const phoneRegex = /^\+2567[0-9]{8}$/;
  return phoneRegex.test(cleaned) ? cleaned : null;
}

// ================= NAME VALIDATION =================
/**
 * FIX: Validate name against _worker.js sanitizeName()
 * REASON: Must allow only letters, spaces, hyphens, apostrophes (1-100 chars)
 */
function validateName(name) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) return null;
  // Allow letters, spaces, hyphens, apostrophes
  if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) return null;
  return trimmed;
}

// ================= DELETE PRODUCT WITH IMAGES =================
/**
 * FIX: Use _worker.js /api/delete-product endpoint
 * REASON: Handles B2 image deletion and product removal atomically
 */
async function deleteProductWithImages(productId) {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Session expired. Please log in again.');
  }

  const res = await fetch('/api/delete-product', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ productId })
  });

  const result = await res.json();

  if (!res.ok) {
    throw new Error(result.error || 'Failed to delete product');
  }

  return result;
}

// ================= PROFILE INITIALIZATION =================
/**
 * FIX: Complete profile initialization flow
 * 1. Check localStorage for user session
 * 2. Verify JWT token exists
 * 3. Call /api/me to get fresh user data
 * 4. Load user listings from Supabase (read-only, not in _worker.js)
 * REASON: Ensures valid session and fresh data on page load
 */
async function initProfile() {
  const storedUser = localStorage.getItem('currentUser');
  if (!storedUser) {
    window.location.href = 'login.html';
    return;
  }
  
  currentUser = JSON.parse(storedUser);

  // FIX: Verify JWT token exists (required by _worker.js)
  const token = getAuthToken();
  if (!token) {
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
    return;
  }

  // FIX: Verify fresh user data from /api/me endpoint
  // REASON: Ensures token is valid and gets latest profile from server
  try {
    const meRes = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!meRes.ok) {
      // FIX: Token invalid/expired - clear session and redirect
      localStorage.removeItem('currentUser');
      localStorage.removeItem('authToken');
      window.location.href = 'login.html';
      return;
    }
    
    const meData = await meRes.json();
    currentUser = meData.user;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
  } catch (err) {
    console.error('Failed to verify session:', err);
    // Continue with cached data if /api/me fails
  }

  // FIX: Safely check verification status (handles boolean, int, or string)
  const isVerified = currentUser.is_verified === true || 
                     currentUser.is_verified === 1 || 
                     currentUser.is_verified === 'true';

  // Update profile display
  profileNameText.textContent = currentUser.full_name || 'No Name';

  if (isVerified) {
    profileVerifiedBadge.classList.remove('hidden');
  } else {
    profileVerifiedBadge.classList.add('hidden');
  }

  profilePhone.textContent = currentUser.phone || '+2567XXXXXXX';
  
  // FIX: Display avatar from /api/upload-image response URL or default icon
  profilePic.innerHTML = currentUser.avatar_url
    ? `<img src="${currentUser.avatar_url}" alt="Profile Picture" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
    : `<i class='bx bxs-user'></i>`;

  // Pre-fill edit form
  editName.value = currentUser.full_name || '';
  editPhone.value = currentUser.phone || '';
  editCurrentPassword.value = '';
  editPassword.value = '';
  editPasswordConfirm.value = '';

  await loadListings();
}

// ================= LOAD USER LISTINGS =================
/**
 * FIX: Load listings from Supabase (read-only)
 * REASON: _worker.js doesn't expose a GET endpoint for products
 * Only user's own products are filtered (user_id = currentUser.id)
 */
async function loadListings() {
  try {
    // FIX: Query only current user's products, sorted by newest first
    const { data: listings, error } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    listingsContainer.innerHTML = '';

    if (error) {
      throw error;
    }

    if (listings && listings.length > 0) {
      listings.forEach(item => {
        const card = document.createElement('div');
        card.className = 'listing-card';

        // FIX: Safely get first image or use placeholder
        const firstImage = item.images && item.images.length > 0 
          ? item.images[0] 
          : 'https://via.placeholder.com/150';
        
        // FIX: Show status with proper styling
        const statusClass = item.status === 'approved' ? 'status-approved' : 'status-pending';
        const statusText = item.status === 'approved' ? 'Approved' : 'Pending';
        
        card.innerHTML = `
          <div class="listing-image-wrapper">
            <img src="${firstImage}" alt="${item.name}" loading="lazy">
            <span class="listing-status ${statusClass}">${statusText}</span>
          </div>
          <div class="listing-info">
            <h4>${item.name}</h4>
            <p class="listing-price">${Intl.NumberFormat('en-UG', { 
              style: 'currency', 
              currency: 'UGX', 
              minimumFractionDigits: 0 
            }).format(item.price)}</p>
            <div class="listing-actions">
              <button class="action-btn edit-btn-listing" data-id="${item.id}">
                <i class='bx bx-edit'></i> Edit
              </button>
              <button class="action-btn delete-btn-listing" data-id="${item.id}">
                <i class='bx bx-trash'></i> Delete
              </button>
            </div>
          </div>
        `;
        
        // FIX: Click anywhere on card (except action buttons) to view product
        card.addEventListener('click', (e) => {
          if (!e.target.closest('.listing-actions')) {
            window.location.href = `product.html?id=${item.id}`;
          }
        });
        
        listingsContainer.appendChild(card);
      });
      
      attachListingActions();
    } else {
      // FIX: Show empty state message
      listingsContainer.innerHTML = '<p style="text-align:center;color:#888;">No listings yet.</p>';
    }
  } catch (err) {
    console.error('Failed to load listings:', err);
    listingsContainer.innerHTML = '<p style="text-align:center;color:#e74c3c;">Failed to load listings.</p>';
  }
}

// ================= ATTACH LISTING ACTIONS =================
/**
 * FIX: Handle edit and delete button clicks
 * REASON: Attach event listeners to dynamically generated buttons
 */
function attachListingActions() {
  // FIX: Edit button - navigate to sell.html with edit parameter
  document.querySelectorAll('.edit-btn-listing').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = btn.dataset.id;
      window.location.href = `sell.html?edit=${productId}`;
    });
  });

  // FIX: Delete button - confirm and call /api/delete-product
  document.querySelectorAll('.delete-btn-listing').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const productId = btn.dataset.id;

      // FIX: Warn user about permanent deletion
      if (!confirm('⚠️ Are you sure? All images will be permanently deleted. This cannot be undone!')) {
        return;
      }

      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Deleting...';

        // FIX: Use /api/delete-product endpoint from _worker.js
        await deleteProductWithImages(productId);

        alert('✅ Listing and images deleted successfully!');
        await loadListings();
      } catch (err) {
        console.error('Delete error:', err);
        alert('❌ Failed to delete listing: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="bx bx-trash"></i> Delete';
      }
    });
  });
}

// ================= PROFILE EDIT VIEW TOGGLE =================
/**
 * FIX: Show edit form and hide profile view
 * REASON: Allow user to edit profile information
 */
btnEditProfile.addEventListener('click', () => {
  profileView.classList.add('hidden');
  profileEdit.classList.remove('hidden');
  // FIX: Reset password fields on edit mode open
  editCurrentPassword.value = '';
  editPassword.value = '';
  editPasswordConfirm.value = '';
  if (passwordStrengthContainer) passwordStrengthContainer.style.display = 'none';
});

/**
 * FIX: Hide edit form and show profile view
 * REASON: Cancel editing without saving
 */
btnCancel.addEventListener('click', () => {
  profileEdit.classList.add('hidden');
  profileView.classList.remove('hidden');
  editCurrentPassword.value = '';
  editPassword.value = '';
  editPasswordConfirm.value = '';
  if (passwordStrengthContainer) passwordStrengthContainer.style.display = 'none';
});

// FIX: Real-time password strength feedback when typing new password
editPassword.addEventListener('input', () => {
  updatePasswordStrength(editPassword.value);
});

// ================= PROFILE EDIT FORM SUBMISSION WITH COMPLETE ERROR HANDLING =================
/**
 * FIXED: Complete profile update with robust error handling
 * - Detailed logging at each step
 * - Specific error messages
 * - Graceful fallbacks
 * - Better debugging
 */
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  console.log('═══════════════════════════════════════');
  console.log('📋 PROFILE UPDATE STARTED');
  console.log('═══════════════════════════════════════');

  // ========== STEP 0: COLLECT FORM DATA ==========
  const newName = editName.value.trim();
  const newPhone = editPhone.value.trim();
  const currentPassword = editCurrentPassword.value;
  const newPassword = editPassword.value;
  const confirmPassword = editPasswordConfirm.value;
  let avatar_url = currentUser.avatar_url || null;

  console.log('📝 Form Data Collected:');
  console.log('  Name:', newName);
  console.log('  Phone:', newPhone);
  console.log('  Current Password:', currentPassword ? '***' : '(empty)');
  console.log('  New Password:', newPassword ? '***' : '(empty)');
  console.log('  Confirm Password:', confirmPassword ? '***' : '(empty)');
  console.log('  Avatar File Selected:', editPic.files.length > 0 ? `Yes (${editPic.files[0].name})` : 'No');

  // ========== STEP 1: VALIDATE NAME ==========
  console.log('\n🔍 VALIDATING NAME...');
  if (!newName) {
    console.error('❌ Name is empty');
    alert('❌ Name cannot be empty');
    return;
  }

  const validatedName = validateName(newName);
  if (!validatedName) {
    console.error('❌ Name validation failed');
    alert('❌ Invalid name. Use only letters, spaces, hyphens, and apostrophes.');
    return;
  }
  console.log('✅ Name valid:', validatedName);

  // ========== STEP 2: VALIDATE PHONE ==========
  console.log('\n🔍 VALIDATING PHONE...');
  if (!newPhone) {
    console.error('❌ Phone is empty');
    alert('❌ Phone cannot be empty');
    return;
  }

  const validatedPhone = validatePhone(newPhone);
  if (!validatedPhone) {
    console.error('❌ Phone validation failed:', newPhone);
    console.log('   Expected format: +2567XXXXXXXX');
    alert('❌ Phone must be in format: +2567XXXXXXXX\n\nExample: +256701234567');
    return;
  }
  console.log('✅ Phone valid:', validatedPhone);

  // ========== STEP 3: VALIDATE PASSWORD (if attempting to change) ==========
  console.log('\n🔍 CHECKING PASSWORD REQUIREMENTS...');
  if (newPassword || confirmPassword) {
    console.log('  User attempting to change password');
    
    if (!newPassword || !confirmPassword) {
      console.error('❌ Password fields partially filled');
      alert('❌ Please enter both new password AND confirm password, or leave both blank to skip');
      return;
    }

    if (newPassword !== confirmPassword) {
      console.error('❌ Passwords do not match');
      alert('❌ New password and confirmation do not match');
      return;
    }

    if (!currentPassword) {
      console.error('❌ Current password required but not provided');
      alert('❌ Current password is required to change your password');
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      console.error('❌ New password does not meet requirements:');
      validation.errors.forEach(err => console.error('   -', err));
      alert('❌ Password requirements not met:\n\n' + validation.errors.join('\n'));
      return;
    }
    console.log('✅ Password requirements met');
  } else {
    console.log('  Skipping password change');
  }

  // ========== STEP 4: CHECK AUTHENTICATION ==========
  console.log('\n🔑 CHECKING AUTHENTICATION...');
  const token = getAuthToken();
  if (!token) {
    console.error('❌ No auth token found');
    alert('❌ Session expired. Please log in again.');
    window.location.href = 'login.html';
    return;
  }
  console.log('✅ Auth token found');

  // Disable save button to prevent double submission
  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Saving...';

  try {
    // ========== STEP 5: UPLOAD AVATAR (if file selected) ==========
    if (editPic.files.length > 0) {
      console.log('\n📸 UPLOADING AVATAR...');
      try {
        const file = editPic.files[0];
        console.log('  File name:', file.name);
        console.log('  Original size:', (file.size / 1024).toFixed(2), 'KB');
        console.log('  File type:', file.type);

        // Validate file type
        if (!file.type.startsWith('image/')) {
          throw new Error('File must be an image (PNG, JPEG, WebP, etc.)');
        }

        console.log('  🔄 Compressing to WebP...');
        const compressedFile = await compressImageTo40KBWebP(file);
        console.log('  Compressed size:', (compressedFile.size / 1024).toFixed(2), 'KB');

        const formData = new FormData();
        formData.append('file', compressedFile);

        console.log('  📤 Sending to /api/upload-image...');
        const uploadRes = await fetch('/api/upload-image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        console.log('  Upload Response Status:', uploadRes.status);

        let uploadData;
        try {
          uploadData = await uploadRes.json();
          console.log('  Upload Response:', uploadData);
        } catch (parseErr) {
          console.error('  ❌ Failed to parse upload response:', parseErr);
          throw new Error(`Upload server error (${uploadRes.status}): Could not parse response`);
        }

        if (!uploadRes.ok) {
          const errorMsg = uploadData.error || uploadData.message || 'Unknown error';
          console.error(`  ❌ Upload failed (${uploadRes.status}):`, errorMsg);
          throw new Error(`Avatar upload failed: ${errorMsg}`);
        }

        if (!uploadData.url) {
          console.error('  ❌ No URL in upload response:', uploadData);
          throw new Error('Server did not return image URL');
        }

        avatar_url = uploadData.url;
        console.log('  ✅ Avatar uploaded:', avatar_url);

      } catch (avatarErr) {
        console.error('❌ Avatar upload failed:', avatarErr.message);
        alert(`❌ Avatar upload failed:\n\n${avatarErr.message}\n\nYou can still update name and phone without changing avatar.`);
        // Continue with profile update without avatar
        avatar_url = currentUser.avatar_url || null;
      }
    } else {
      console.log('\n📸 No avatar file selected, skipping upload');
    }

    // ========== STEP 6: UPDATE PROFILE (name, phone, avatar) ==========
    console.log('\n👤 UPDATING PROFILE...');
    
    const profileUpdates = {
      full_name: validatedName,
      phone: validatedPhone
    };

    if (avatar_url && avatar_url !== currentUser.avatar_url) {
      profileUpdates.avatar_url = avatar_url;
      console.log('  Including new avatar URL');
    }

    console.log('  📤 Sending updates to /api/update-profile:');
    console.log('    ', JSON.stringify(profileUpdates, null, 2));

    const updateRes = await fetch('/api/update-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(profileUpdates)
    });

    console.log('  Update Response Status:', updateRes.status);

    let updateData;
    try {
      updateData = await updateRes.json();
      console.log('  Update Response Data:', updateData);
    } catch (parseErr) {
      console.error('  ❌ Failed to parse update response:', parseErr);
      throw new Error(`Profile update server error (${updateRes.status}): Could not parse response`);
    }

    if (!updateRes.ok) {
      const errorMsg = updateData.error || updateData.details || updateData.message || 'Unknown error';
      console.error(`  ❌ Profile update failed (${updateRes.status}):`, errorMsg);
      
      // Parse specific error messages
      let userFriendlyError = errorMsg;
      if (errorMsg.includes('phone')) {
        userFriendlyError = 'This phone number is already in use by another account.';
      } else if (errorMsg.includes('name')) {
        userFriendlyError = 'Invalid name format.';
      }
      
      throw new Error(userFriendlyError);
    }

    console.log('  ✅ Profile updated successfully');

    // ========== STEP 7: CHANGE PASSWORD (if provided) ==========
    if (newPassword) {
      console.log('\n🔐 CHANGING PASSWORD...');
      try {
        console.log('  📤 Sending to /api/change-password...');
        const passwordRes = await fetch('/api/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            currentPassword: currentPassword,
            newPassword: newPassword
          })
        });

        console.log('  Password Change Response Status:', passwordRes.status);

        let passwordData;
        try {
          passwordData = await passwordRes.json();
          console.log('  Password Change Response:', passwordData);
        } catch (parseErr) {
          console.error('  ❌ Failed to parse password response:', parseErr);
          throw new Error(`Password change server error (${passwordRes.status}): Could not parse response`);
        }

        if (!passwordRes.ok) {
          const errorMsg = passwordData.error || passwordData.message || 'Unknown error';
          console.error(`  ❌ Password change failed (${passwordRes.status}):`, errorMsg);
          throw new Error(`Password change failed: ${errorMsg}`);
        }

        console.log('  ✅ Password changed successfully');
        alert('✅ Password changed successfully!');

      } catch (passwordErr) {
        console.error('❌ Password change error:', passwordErr.message);
        alert(`⚠️ Profile updated, but password change failed:\n\n${passwordErr.message}`);
      }
    }

    // ========== STEP 8: UPDATE LOCAL STATE ==========
    console.log('\n💾 UPDATING LOCAL STATE...');
    if (updateData.user) {
      currentUser = updateData.user;
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      console.log('  ✅ Local state updated');
    } else {
      console.warn('  ⚠️ No user data in response, keeping current local state');
    }

    // ========== STEP 9: REFRESH DISPLAY ==========
    console.log('\n🎨 REFRESHING DISPLAY...');
    profileNameText.textContent = currentUser.full_name || 'No Name';
    
    const isVerified = currentUser.is_verified === true || 
                       currentUser.is_verified === 1 || 
                       currentUser.is_verified === 'true';
    
    if (isVerified) {
      profileVerifiedBadge.classList.remove('hidden');
    } else {
      profileVerifiedBadge.classList.add('hidden');
    }

    profilePhone.textContent = currentUser.phone;
    
    if (currentUser.avatar_url) {
      profilePic.innerHTML = `<img src="${currentUser.avatar_url}" alt="Profile Picture" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      profilePic.innerHTML = `<i class='bx bxs-user'></i>`;
    }
    console.log('  ✅ Display refreshed');

    // ========== STEP 10: CLOSE EDIT FORM ==========
    console.log('\n📖 CLOSING EDIT FORM...');
    alert('✅ Profile updated successfully!');
    profileEdit.classList.add('hidden');
    profileView.classList.remove('hidden');
    
    // Clear form
    editCurrentPassword.value = '';
    editPassword.value = '';
    editPasswordConfirm.value = '';
    editPic.value = '';
    
    if (passwordStrengthContainer) {
      passwordStrengthContainer.style.display = 'none';
    }
    
    console.log('  ✅ Form closed and cleared');

    console.log('\n═══════════════════════════════════════');
    console.log('✅ PROFILE UPDATE COMPLETED SUCCESSFULLY');
    console.log('═══════════════════════════════════════\n');

  } catch (err) {
    // ========== ERROR HANDLING ==========
    console.error('\n═══════════════════════════════════════');
    console.error('❌ PROFILE UPDATE FAILED');
    console.error('═══════════════════════════════════════');
    console.error('Error Message:', err.message);
    console.error('Error Stack:', err.stack);
    console.error('═══════════════════════════════════════\n');

    const userMessage = err.message.includes('Failed to parse') 
      ? 'Server communication error. Please try again.'
      : err.message;

    alert(`❌ ${userMessage}`);

  } finally {
    // ========== ALWAYS RESTORE BUTTON STATE ==========
    console.log('🔄 Restoring button state...');
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="bx bx-save"></i> Save Changes';
  }
});

// ================= LOGOUT =================
/**
 * FIX: Clear JWT token and user session on logout
 * REASON: Prevents unauthorized access after logout
 */
btnLogout.addEventListener('click', () => {
  localStorage.removeItem('currentUser');
  localStorage.removeItem('authToken'); // FIX: Clear JWT token
  window.location.href = 'login.html';
});

// ================= HEADER SHRINK ON SCROLL =================
const profileHeader = document.querySelector('.profile-header');
window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    profileHeader.classList.add('shrink');
  } else {
    profileHeader.classList.remove('shrink');
  }
});

// ================= IMAGE COMPRESSION (WebP ~40KB) =================
/**
 * FIX: Compress image to ~40KB WebP format
 * REASON: Reduces upload size, _worker.js stores in B2 with /images/ proxy
 */
async function compressImageTo40KBWebP(file) {
  const targetSize = 40 * 1024; // 40KB
  let quality = 0.9;
  let width = 400;
  let height = 400;
  let compressedFile = file;

  // FIX: Iteratively reduce quality until target size reached
  while (quality > 0.1) {
    compressedFile = await compressImage(file, width, height, quality);

    if (compressedFile.size <= targetSize) {
      console.log(`✅ Avatar compressed to ${(compressedFile.size / 1024).toFixed(2)}KB`);
      return compressedFile;
    }

    quality -= 0.05;
  }

  // FIX: If still over, reduce dimensions
  while (compressedFile.size > targetSize && width > 100) {
    width -= 50;
    height -= 50;
    compressedFile = await compressImage(file, width, height, 0.6);

    if (compressedFile.size <= targetSize) {
      console.log(`✅ Avatar compressed to ${(compressedFile.size / 1024).toFixed(2)}KB`);
      return compressedFile;
    }
  }

  console.log(`⚠️ Final avatar size ${(compressedFile.size / 1024).toFixed(2)}KB`);
  return compressedFile;
}

/**
 * FIX: Compress single image to target dimensions and quality
 * REASON: Creates WebP blob with specified quality
 */
function compressImage(file, maxWidth, maxHeight, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = () => {
      let { width, height } = img;

      // FIX: Maintain aspect ratio while resizing
      if (width > height) {
        if (width > maxWidth) {
          height = Math.floor((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.floor((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // FIX: Force WebP format output
      canvas.toBlob(
        (blob) => {
          const compressedFile = new File(
            [blob],
            `avatar_${Date.now()}.webp`,
            { type: 'image/webp' }
          );
          resolve(compressedFile);
        },
        'image/webp',
        quality
      );
    };

    img.onerror = () => {
      console.warn('Image load failed, using original');
      resolve(file); // FIX: Return original if error
    };
  });
}

// ================= DEBUG HELPER FUNCTION =================
/**
 * Call this function in browser console to get debug info
 * Usage: logDebugInfo()
 */
function logDebugInfo() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║         DEBUG INFORMATION              ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('🔑 AUTHENTICATION:');
  console.log('  Token exists:', !!getAuthToken());
  console.log('  Token prefix:', getAuthToken()?.substring(0, 20) + '...' || 'none');
  console.log('  Current User ID:', currentUser?.id || 'unknown');

  console.log('\n👤 CURRENT USER DATA:');
  console.log('  Name:', currentUser?.full_name);
  console.log('  Phone:', currentUser?.phone);
  console.log('  Avatar:', currentUser?.avatar_url);
  console.log('  Verified:', currentUser?.is_verified);

  console.log('\n🌐 API ENDPOINTS:');
  console.log('  Base URL: /api');
  console.log('  Update Profile: POST /api/update-profile');
  console.log('  Change Password: POST /api/change-password');
  console.log('  Upload Image: POST /api/upload-image');

  console.log('\n📋 VALIDATION RULES:');
  console.log('  Phone Format: /^\\+2567[0-9]{8}$/');
  console.log('  Password Min Length:', PASSWORD_MIN_LENGTH);
  console.log('  Password Max Length:', PASSWORD_MAX_LENGTH);
  console.log('  Password Requires: Uppercase, Lowercase, Numbers');

  console.log('\n✅ Debug info logged. Check the Network tab for API responses.\n');
}

// Make it globally accessible for debugging
window.logDebugInfo = logDebugInfo;

// ================= INITIALIZE PAGE =================
initProfile();
