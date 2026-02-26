// -------------------------
// SELL.JS (Updated with Free Ads Limit + Dynamic Image Limits + WhatsApp Integration)
// -------------------------

// -------------------------
// SUPABASE SETUP (NO MODULES)
// -------------------------
const SUPABASE_URL = "https://gpkufzayrvfippxqfafa.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwa3VmemF5cnZmaXBweHFmYWZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NjMwNDQsImV4cCI6MjA4NTAzOTA0NH0.3YHPrjJ65mn20ECCYCvbO56jWWUVLy1IGFzXp83Gn9U";

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

// -------------------------
// ADMIN CONTACT (Hidden from frontend)
// -------------------------
const ADMIN_WHATSAPP = "256768786757";

// -------------------------
// EDIT MODE DETECTION
// -------------------------
const urlParams = new URLSearchParams(window.location.search);
const editProductId = urlParams.get('edit');
let isEditMode = !!editProductId;
let currentProduct = null;
let existingImageUrls = []; // Keep track of existing uploaded images

// -------------------------
// STATE
// -------------------------
let currentStep = 1;
let uploadedImages = [];
const minImages = 1;
let maxImages = 1; // Dynamic based on ad type

// -------------------------
// CONSTANTS
// -------------------------
const MAX_FREE_ADS = 3; // Maximum active free ads per user

// -------------------------
// IMAGE COMPRESSION FUNCTION (50 KB) - Slow Learner Method
// -------------------------
async function compressTo50KB(file) {  
    const img = await imageCompression.getDataUrlFromFile(file);  
    const image = new Image();  
    image.src = img;  
    await new Promise(resolve => image.onload = resolve);  

    let maxWidth = image.width;  
    let maxHeight = image.height;  

    // Reduce dimensions only if very large
    if (image.width > 1200 || image.height > 1200) {  
        const scale = 1200 / Math.max(image.width, image.height);  
        maxWidth = Math.floor(image.width * scale);  
        maxHeight = Math.floor(image.height * scale);  
    }  

    const compressedFile = await imageCompression(file, {  
        maxSizeMB: 0.05,          // 50 KB  
        maxWidthOrHeight: Math.max(maxWidth, maxHeight),  
        fileType: "image/webp",  
        useWebWorker: true,  
        initialQuality: 0.9       // Start high, auto reduces if needed  
    });  

    return new File([compressedFile], `${Date.now()}.webp`, { type: "image/webp" });  
}

// -------------------------
// AD PLANS CONFIG WITH IMAGE LIMITS
// -------------------------
const AD_PLANS = {
    free: {
        price: 0,
        duration: 30, // Free ads last 30 days
        maxImages: 1
    },
    "7days": {
        price: 5000,
        duration: 7,
        maxImages: 3
    },
    "30days": {
        price: 15000,
        duration: 30,
        maxImages: 5
    },
    featured: {
        price: 50000,
        duration: 30,
        maxImages: 8
    }
};

// -------------------------
// DOM ELEMENTS
// -------------------------
const adTypeSelect = document.getElementById('adType');
const adPriceDisplay = document.getElementById('adPrice');
const adImageLimitDisplay = document.getElementById('adImageLimit');
const sellForm = document.getElementById('sellForm');
const titleInput = document.getElementById('itemTitle');
const descInput = document.getElementById('itemDescription');
const titleCount = document.getElementById('titleCount');
const descCount = document.getElementById('descCount');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const photoCounter = document.getElementById('photoCounter');

// -------------------------
// CHARACTER COUNTERS
// -------------------------
titleInput.addEventListener('input', () => {
    titleCount.textContent = titleInput.value.length;
    titleCount.style.color = titleInput.value.length > 60 ? 'red' : titleInput.value.length > 30 ? 'orange' : 'black';
});

descInput.addEventListener('input', () => {
    descCount.textContent = descInput.value.length;
    descCount.style.color = descInput.value.length > 1800 ? 'red' : descInput.value.length > 1500 ? 'orange' : 'black';
});

// -------------------------
// CHECK ACTIVE FREE ADS LIMIT (INCLUDES PENDING AND EDITED)
// -------------------------
async function checkActiveFreeAdsLimit(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('products')
            .select('id')
            .eq('user_id', userId)
            .eq('ad_type', 'free')
            .in('status', ['approved', 'pending', 'edited']); // 🔧 Count pending and edited as well

        if (error) throw error;

        const activeFreeAds = data ? data.length : 0;
        
        return {
            count: activeFreeAds,
            canPost: activeFreeAds < MAX_FREE_ADS,
            remaining: MAX_FREE_ADS - activeFreeAds
        };
    } catch (err) {
        console.error('Error checking free ads limit:', err);
        return { count: 0, canPost: true, remaining: MAX_FREE_ADS };
    }
}

// -------------------------
// UPDATE MAX IMAGES BASED ON AD TYPE
// -------------------------
async function updateImageLimits() {
    const selectedAdType = adTypeSelect.value;
    const plan = AD_PLANS[selectedAdType];
    
    if (plan) {
        maxImages = plan.maxImages;
        updatePhotoCounter();
        
        // Update price display
        adPriceDisplay.textContent = plan.price === 0
            ? "Price: Free"
            : `Price: UGX ${plan.price.toLocaleString()} (${plan.duration} days)`;
        
        // Update image limit display
        adImageLimitDisplay.textContent = `Image limit: ${plan.maxImages} photo${plan.maxImages > 1 ? 's' : ''}`;
        
        // Check if user needs to remove images
        const totalImages = existingImageUrls.length + uploadedImages.length;
        if (totalImages > maxImages) {
            const excess = totalImages - maxImages;
            alert(`⚠️ You have ${totalImages} images but this plan allows only ${maxImages}. Please remove ${excess} image${excess > 1 ? 's' : ''} before proceeding.`);
        }

        // Show free ads limit info if selecting free ad type (only for new posts, not edits)
        if (selectedAdType === 'free' && !isEditMode) {
            const currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (currentUser) {
                const freeAdsStatus = await checkActiveFreeAdsLimit(currentUser.id);
                
                // Update the ad note with free ads limit info
                const adNote = document.querySelector('.ad-note');
                if (adNote) {
                    adNote.innerHTML = `
                        Paid ads get more visibility and appear higher in search results. Image limit increases with paid plans.<br>
                        <strong style="color: ${freeAdsStatus.canPost ? '#10b981' : '#ef4444'};">
                            Free ads: ${freeAdsStatus.count}/${MAX_FREE_ADS} active (including pending)
                            ${freeAdsStatus.canPost ? `(${freeAdsStatus.remaining} remaining)` : '(Limit reached)'}
                        </strong>
                    `;
                }
            }
        }
    } else {
        adPriceDisplay.textContent = "Price: —";
        adImageLimitDisplay.textContent = "Image limit: —";
    }
}

// -------------------------
// SECURITY HELPER: Get stored JWT token
// -------------------------
function getAuthToken() {
    return localStorage.getItem('authToken') || null;
}

// -------------------------
// LOAD PRODUCT FOR EDIT
// -------------------------
async function loadProductForEdit(productId) {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        
        if (!currentUser) {
            alert('Please log in first');
            window.location.href = 'login.html';
            return;
        }

        // SECURITY: Fetch product and enforce ownership via the anon key query.
        // The worker will also enforce ownership on any mutating request.
        const { data, error } = await supabaseClient
            .from('products')
            .select('*')
            .eq('id', productId)
            .eq('user_id', currentUser.id) // Ownership check: only owner's products
            .single();

        if (error) throw error;

        if (!data) {
            alert('Product not found or you do not have permission to edit it');
            window.location.href = 'profile.html';
            return;
        }

        currentProduct = data;
        existingImageUrls = data.images || [];

        // Populate form fields
        titleInput.value = data.name || '';
        document.getElementById('itemCategory').value = data.category || '';
        descInput.value = data.description || '';
        document.getElementById('itemPrice').value = data.price || '';
        document.getElementById('itemLocation').value = data.location || '';
        
        // Phone - remove +256 prefix if present
        const phoneField = document.getElementById('contactPhone');
        if (data.phone) {
            phoneField.value = data.phone.replace('+256', '').replace(/^0/, '');
        }
        
        document.getElementById('negotiable').checked = data.negotiable || false;
        document.getElementById('installment').checked = data.installment || false;

        // Set condition radio
        const conditionRadio = document.querySelector(`input[name="condition"][value="${data.condition}"]`);
        if (conditionRadio) conditionRadio.checked = true;

        // Set ad type and LOCK it
        if (adTypeSelect) {
            adTypeSelect.value = data.ad_type || 'free';
            adTypeSelect.disabled = true; // Lock the dropdown
            
            // Update limits based on locked ad type
            await updateImageLimits();
            
            // Add visual indicator that it's locked
            const adTypeGroup = adTypeSelect.closest('.form-group');
            if (adTypeGroup && !document.querySelector('.ad-type-lock-note')) {
                const lockNote = document.createElement('p');
                lockNote.className = 'ad-type-lock-note';
                lockNote.style.cssText = 'color: #f59e0b; font-size: 0.9em; margin-top: 5px; font-weight: 500;';
                lockNote.innerHTML = '<i class="bx bx-lock-alt"></i> Ad type cannot be changed when editing';
                adTypeGroup.appendChild(lockNote);
            }
        }

        // Update character counts
        titleCount.textContent = titleInput.value.length;
        descCount.textContent = descInput.value.length;

        // Display existing images
        displayExistingImages(existingImageUrls);

        // Update page title and button
        const pageTitle = document.querySelector('.form-card h2');
        if (pageTitle) pageTitle.textContent = 'Edit Your Listing';
        
        const submitBtn = document.querySelector('.btn-submit');
        if (submitBtn) submitBtn.textContent = 'Update Listing';

    } catch (err) {
        console.error('Error loading product:', err);
        alert('Failed to load product for editing');
        window.location.href = 'profile.html';
    }
}

// -------------------------
// DISPLAY EXISTING IMAGES
// -------------------------
function displayExistingImages(images) {
    imagePreview.innerHTML = '';
    
    images.forEach((imageUrl, index) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.dataset.url = imageUrl;
        div.innerHTML = `
            <img src="${imageUrl}" alt="Preview">
            <div class="preview-actions">
                <button type="button" class="action-btn remove" onclick="removeExistingImage('${imageUrl}')">
                    <i class='bx bx-trash'></i>
                </button>
            </div>
        `;
        imagePreview.appendChild(div);
    });
    
    updatePhotoCounter();
}

// -------------------------
// REMOVE EXISTING IMAGE
// -------------------------
window.removeExistingImage = function(imageUrl) {
    existingImageUrls = existingImageUrls.filter(url => url !== imageUrl);
    const el = document.querySelector(`.preview-item[data-url="${imageUrl}"]`);
    if (el) el.remove();
    updatePhotoCounter();
};

// -------------------------
// STEP NAVIGATION
// -------------------------
function nextStep() {
    if (!validateStep(currentStep)) return;
    document.getElementById(`step${currentStep}`).style.display = 'none';
    currentStep++;
    document.getElementById(`step${currentStep}`).style.display = 'block';
    updateStepIndicators();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function prevStep() {
    document.getElementById(`step${currentStep}`).style.display = 'none';
    currentStep--;
    document.getElementById(`step${currentStep}`).style.display = 'block';
    updateStepIndicators();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepIndicators() {
    document.querySelectorAll('.step-number').forEach((num, index) => {
        const stepNum = index + 1;
        if (stepNum === currentStep) {
            num.classList.add('active');
            num.classList.remove('completed');
        } else if (stepNum < currentStep) {
            num.classList.add('completed');
            num.classList.remove('active');
        } else {
            num.classList.remove('active', 'completed');
        }
    });
}

// -------------------------
// STEP VALIDATION
// -------------------------
function validateStep(step) {
    let isValid = true;
    switch(step) {
        case 1:
            const title = titleInput.value.trim();
            const category = document.getElementById('itemCategory').value;
            const condition = document.querySelector('input[name="condition"]:checked');

            if (!title || title.length < 10) {
                alert('Title must be at least 10 characters');
                isValid = false;
            }
            if (!category) {
                alert('Please select a category');
                isValid = false;
            }
            if (!condition) {
                alert('Please select the item condition');
                isValid = false;
            }
            break;

        case 2:
            const desc = descInput.value.trim();
            const price = document.getElementById('itemPrice').value;

            if (!desc || desc.length < 20) {
                alert('Description must be at least 20 characters');
                isValid = false;
            } else if (desc.length > 2000) { // 🔧 NEW: Enforce 2000 character limit
                alert('Description must not exceed 2000 characters');
                isValid = false;
            }

            // Validate price is a positive whole number
            if (!price || parseInt(price) <= 0 || !/^\d+$/.test(price)) {
                alert('Please enter a valid price (whole number, e.g., 500)');
                isValid = false;
            }
            break;
        case 3:
            // Validate ad type selection
            if (!adTypeSelect.value) {
                alert('Please select an ad type');
                isValid = false;
            }
            break;

        case 4:
            // Validate images based on selected ad type
            const totalImages = existingImageUrls.length + uploadedImages.length;
            if (totalImages < minImages) {
                alert(`Please upload at least ${minImages} photo`);
                isValid = false;
            } else if (totalImages > maxImages) {
                alert(`You can only have up to ${maxImages} photos for the selected ad type. Please remove ${totalImages - maxImages} image(s).`);
                isValid = false;
            }
            break;
    }
    return isValid;
}

// -------------------------
// IMAGE HANDLING
// -------------------------
imageInput.addEventListener('change', function() {
    handleImageUpload(this.files);
});

async function handleImageUpload(files) {
    const currentTotalImages = existingImageUrls.length + uploadedImages.length;
    const remainingSlots = maxImages - currentTotalImages;
    
    if (remainingSlots <= 0) {
        alert(`You can only upload ${maxImages} photos total for this ad type`);
        return;
    }
    
    if (files.length > remainingSlots) {
        alert(`You can only upload ${remainingSlots} more photo(s)`);
    }

    for (const file of Array.from(files).slice(0, remainingSlots)) {
        if (!file.type.startsWith('image/')) {
            alert('Only images allowed');
            continue;
        }
        if (file.size > 5 * 1024 * 1024) {
            alert('Max 5MB per image');
            continue;
        }

        try {
            // Compress image to ≤50 KB using slow learner method
            const compressedFileWithName = await compressTo50KB(file);

            // Generate unique ID for this image
            const id = Date.now() + Math.random();

            uploadedImages.push({
                id,
                file: compressedFileWithName,
                url: URL.createObjectURL(compressedFileWithName)
            });

            // Show preview
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.dataset.id = id;
            div.innerHTML = `
                <img src="${URL.createObjectURL(compressedFileWithName)}" alt="Preview">
                <div class="preview-actions">
                    <button type="button" class="action-btn remove" onclick="removeImage('${id}')">
                        <i class='bx bx-trash'></i>
                    </button>
                </div>
            `;
            imagePreview.appendChild(div);
            updatePhotoCounter();

        } catch (err) {
            console.error("Image compression error:", err);
            alert("Failed to compress image. Try another one.");
        }
    }
}

function removeImage(id) {
    uploadedImages = uploadedImages.filter(img => img.id != id);
    const el = document.querySelector(`.preview-item[data-id="${id}"]`);
    if (el) el.remove();
    updatePhotoCounter();
}

window.removeImage = removeImage;

function updatePhotoCounter() {
    const totalImages = existingImageUrls.length + uploadedImages.length;
    photoCounter.textContent = `${totalImages}/${maxImages} photos`;
}

// -------------------------
// COLLECT FORM DATA
// -------------------------
function collectFormData(currentUser) {
    const phone = document.getElementById('contactPhone').value;
    const formattedPhone = phone.startsWith('+256') ? phone : '+256' + phone.replace(/^0/, '');

    const selectedPlan = AD_PLANS[adTypeSelect.value] || AD_PLANS.free;

    // Calculate expiry date
    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setDate(expiryDate.getDate() + selectedPlan.duration);

    return {
        name: titleInput.value.trim(),
        title: titleInput.value.trim(),
        category: document.getElementById('itemCategory').value,
        condition: document.querySelector('input[name="condition"]:checked').value,
        description: descInput.value.trim(),
        price: parseFloat(document.getElementById('itemPrice').value),
        negotiable: document.getElementById('negotiable').checked,
        installment: document.getElementById('installment').checked,
        location: document.getElementById('itemLocation').value,
        phone: formattedPhone,
        user_id: currentUser.id,

        // AD DATA
        ad_type: adTypeSelect.value,
        ad_price: selectedPlan.price,
        ad_duration: selectedPlan.duration,
        is_featured: adTypeSelect.value === "featured",
        expires_at: expiryDate.toISOString() // Add expiry timestamp
    };
}

// -------------------------
// BACKBLAZE IMAGE UPLOAD (via Cloudflare Pages Function)
// -------------------------
async function uploadImagesToBackblaze() {
    if (uploadedImages.length === 0) return [];

    const uploadPromises = uploadedImages.map(async (img) => {
        const formData = new FormData();
        formData.append('file', img.file);

        const res = await fetch('/api/upload-image', {
            method: 'POST',
            body: formData
        });

        let data;

        try {
            data = await res.json();
        } catch (e) {
            throw new Error("Server returned invalid JSON");
        }

        if (!res.ok || !data.success) {
            console.error("Upload error:", data);
            throw new Error(data.error || "Image upload failed");
        }

        return data.url;
    });

    return Promise.all(uploadPromises);
}

// -------------------------
// WHATSAPP PAYMENT NOTIFICATION
// -------------------------
function openWhatsAppForPayment(listingData, currentUser) {
    // Only trigger for PAID ads (not free)
    if (listingData.ad_type === 'free') {
        return; // Do nothing for free ads
    }

    // Get ad type display name
    const adTypeNames = {
        '7days': 'Boosted – 7 Days',
        '30days': 'Boosted – 30 Days',
        'featured': 'Featured – 30 Days'
    };

    const adTypeName = adTypeNames[listingData.ad_type] || listingData.ad_type;

    // Build WhatsApp message
    const message = `Hello Admin, I want to pay for my listing.

Title: ${listingData.title}
Ad Type: ${adTypeName}
Payment Phone: ${listingData.phone}
Name: ${currentUser.full_name || currentUser.email || 'User'}`;

    // Encode message for URL
    const encodedMessage = encodeURIComponent(message);

    // Build WhatsApp URL
    const whatsappUrl = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodedMessage}`;

    // Open WhatsApp in new window
    window.open(whatsappUrl, '_blank');
}

// -------------------------
// FORM SUBMIT
// -------------------------
sellForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    const currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;

    // SECURITY: Only logged-in users can submit listings
    if (!currentUser) {
        alert('Please log in to post a listing!');
        window.location.href = 'login.html';
        return;
    }

    // SECURITY: Require a valid auth token for any submission
    const token = getAuthToken();
    if (!token) {
        alert('Your session has expired. Please log in again.');
        window.location.href = 'login.html';
        return;
    }

    // Validate all steps
    for (let i = 1; i <= 5; i++) {
        if (!validateStep(i)) {
            currentStep = i;
            document.querySelectorAll('.form-step').forEach((step, idx) => {
                step.style.display = idx === i - 1 ? 'block' : 'none';
            });
            updateStepIndicators();
            return;
        }
    }

    // CHECK FREE ADS LIMIT (only for new free ads, not edits)
    if (!isEditMode && adTypeSelect.value === 'free') {
        const freeAdsStatus = await checkActiveFreeAdsLimit(currentUser.id);
        
        if (!freeAdsStatus.canPost) {
            alert(`❌ You have reached the limit of ${MAX_FREE_ADS} active free ads (including pending).\n\nTo post more:\n• Upgrade to a paid ad type, OR\n• Wait for one of your free ads to expire (after 30 days), OR\n• Delete one of your existing free ads`);
            return;
        }
    }

    const submitBtn = document.querySelector('.btn-submit');
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = isEditMode ? 'Updating...' : 'Posting...';

    try {
        // Upload new images to Backblaze
        const newImageUrls = await uploadImagesToBackblaze();

        // Combine existing + new image URLs
        const allImageUrls = [...existingImageUrls, ...newImageUrls];

        // Collect form data
        const listing = collectFormData(currentUser);
        listing.images = allImageUrls;

        let result;

        if (isEditMode) {
            // SECURITY: Update product via _worker.js — server enforces ownership
            listing.status = "edited";

            const res = await fetch(`/api/update-product`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` // JWT carries userId & role
                },
                body: JSON.stringify({ productId: editProductId, updates: listing })
            });

            result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Update failed');

        } else {
            // SECURITY: Insert product via _worker.js — server attaches user_id from JWT
            listing.status = "pending";

            const res = await fetch(`/api/create-product`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` // JWT carries userId & role
                },
                body: JSON.stringify({ listing })
            });

            result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Create failed');
        }

        // Show success message
        alert(isEditMode ? 
            "Listing updated successfully ✅ Changes will be reviewed by admin." : 
            "Listing submitted successfully ✅ Pending admin approval."
        );

        // Open WhatsApp for PAID ads only (not for edits, only new posts)
        if (!isEditMode) {
            openWhatsAppForPayment(listing, currentUser);
        }

        // Redirect to profile
        window.location.href = 'profile.html';

    } catch(err) {
        console.error("Listing submit error:", err);
        alert(`Failed to ${isEditMode ? 'update' : 'submit'} listing.\n${err.message || JSON.stringify(err)}`);
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
});

// -------------------------
// AD TYPE CHANGE HANDLER
// -------------------------
if (adTypeSelect) {
    adTypeSelect.addEventListener('change', updateImageLimits);
}

// -------------------------
// INIT
// -------------------------
document.addEventListener('DOMContentLoaded', async () => {
    updateStepIndicators();
    titleCount.textContent = '0';
    descCount.textContent = '0';
    updatePhotoCounter();

    // 🔧 Set maxlength for description (2000 characters)
    if (descInput) {
        descInput.setAttribute('maxlength', '2000');
    }

    // Load product data if in edit mode
    if (isEditMode) {
        await loadProductForEdit(editProductId);
    }
});