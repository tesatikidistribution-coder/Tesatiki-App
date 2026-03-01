// _worker.js - PRODUCTION-READY VERSION (IMAGES FIXED)
// ✅ All functionality preserved
// ✅ Image proxy fully working with correct B2 API endpoints
// ✅ Detailed error reporting with debugging

const SUPABASE_URL = "https://gpkufzayrvfippxqfafa.supabase.co";
const SUPABASE_REST_USERS = `${SUPABASE_URL}/rest/v1/users`;
const SUPABASE_REST_PRODUCTS = `${SUPABASE_URL}/rest/v1/products`;

// ========================
// SECURITY CONSTANTS
// ========================
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const PBKDF2_ITERATIONS = 100000;
const JWT_EXPIRY_HOURS = 8;
const MAX_LOGIN_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

// ========================
// CACHING CONSTANTS
// ========================
const PRODUCT_CACHE_TTL = 10 * 60; // Cache products for 10 minutes (600 seconds)
const PRODUCT_CACHE_KEY = 'tesatiki:products:approved';
const IMAGE_CACHE_TTL = 31536000; // Cache images for 1 year (immutable)

let cachedAuth = null;
let authTimestamp = 0;

// ========================
// Crypto helpers
// ========================
async function randomBytes(length = 16) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function base64UrlEncode(buffer) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

// ========================
// PASSWORD VALIDATION & HASHING
// ========================
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, error: `Password must not exceed ${PASSWORD_MAX_LENGTH} characters` };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}

// PBKDF2 password hashing: returns string "pbkdf2$<iterations>$<saltHex>$<hashBase64url>"
async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const saltArr = await randomBytes(16);
  const saltHex = toHex(saltArr);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltArr, iterations, hash: 'SHA-256' },
    keyMaterial,
    256 // bits => 32 bytes
  );
  const hashB64Url = base64UrlEncode(derived);
  return `pbkdf2$${iterations}$${saltHex}$${hashB64Url}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expectedB64Url = parts[3];

  const salt = fromHex(saltHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const derivedB64Url = base64UrlEncode(derived);
  
  // Constant-time compare to prevent timing attacks
  return constantTimeEqual(derivedB64Url, expectedB64Url);
}

// Constant-time string comparison
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ========================
// JWT helpers (HS256)
// ========================
async function signJWT(payload, env, expiresInSeconds = JWT_EXPIRY_HOURS * 60 * 60) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const enc = new TextEncoder();
  const headerB = enc.encode(JSON.stringify(header));
  const bodyB = enc.encode(JSON.stringify(body));
  const signingInput = `${base64UrlEncode(headerB)}.${base64UrlEncode(bodyB)}`;
  
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${base64UrlEncode(sig)}`;
  return token;
}

async function verifyJWT(token, env) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [header64, payload64, sig64] = parts;
    const signingInput = `${header64}.${payload64}`;
    const enc = new TextEncoder();
    
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(env.JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const sig = base64UrlDecode(sig64);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sig,
      new TextEncoder().encode(signingInput)
    );
    
    if (!isValid) return null;
    
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payload64));
    const payload = JSON.parse(payloadJson);
    const now = Math.floor(Date.now() / 1000);
    
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

// ========================
// Supabase REST helpers (service role key)
// ========================
function svcHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function getUserByPhone(phone, env) {
  const res = await fetch(`${SUPABASE_REST_USERS}?phone=eq.${encodeURIComponent(phone)}&select=*`, {
    headers: svcHeaders(env)
  });
  if (!res.ok) return null;
  const arr = await res.json();
  return arr && arr.length > 0 ? arr[0] : null;
}

async function getUserById(id, env) {
  const res = await fetch(`${SUPABASE_REST_USERS}?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: svcHeaders(env)
  });
  if (!res.ok) return null;
  const arr = await res.json();
  return arr && arr.length > 0 ? arr[0] : null;
}

// ========================
// Input Sanitization
// ========================
function sanitizePhone(phone) {
  // Remove whitespace and validate format
  if (!phone || typeof phone !== 'string') return null;
  const cleaned = phone.replace(/\s/g, '');
  // Basic validation: must start with +256 and be 13 chars
  if (!/^\+2567[0-9]{8}$/.test(cleaned)) return null;
  return cleaned;
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  // Allow only letters, spaces, hyphens, apostrophes
  if (!/^[a-zA-Z\s\-']{1,100}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeProductFields(raw) {
  // Fields that only the server or admin may set
  const BLOCKED_FIELDS = [
    'id', 'user_id', 'status', 'admin_approved', 'approved_at',
    'is_featured', 'featured_until', 'boosted_at', 'boosted_until',
    'expires_at', 'created_at', 'updated_at', 'role', 'password', 'password_hash'
  ];
  const sanitized = { ...raw };
  for (const field of BLOCKED_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

// ========================
// Backblaze B2 helpers
// ========================
async function getB2Auth(env) {
  const now = Date.now();
  if (cachedAuth && now - authTimestamp < 23 * 60 * 60 * 1000) {
    return cachedAuth;
  }

  const authResp = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: {
      Authorization: "Basic " + btoa(`${env.B2_KEY_ID}:${env.B2_APP_KEY}`)
    }
  });

  if (!authResp.ok) throw new Error("B2 authorization failed");

  cachedAuth = await authResp.json();
  authTimestamp = now;
  return cachedAuth;
}

// ========================
// IMAGE DELETION (all versions)
// ========================
async function deleteImagesFromB2(imageUrls, env) {
  if (!imageUrls || imageUrls.length === 0) {
    return { success: true, deleted: 0 };
  }

  const authData = await getB2Auth(env);
  let deletedCount = 0;
  const errors = [];

  for (const url of imageUrls) {
    try {
      let filename = url;
      if (url.startsWith('/images/')) {
        filename = url.replace('/images/', '');
      } else if (url.includes('/images/')) {
        filename = url.split('/images/')[1];
      }

      const allVersions = [];
      let startFileName = filename;
      let startFileId = null;
      let keepPaging = true;

      while (keepPaging) {
        const listBody = {
          bucketId: env.B2_BUCKET_ID,
          startFileName: startFileName,
          maxFileCount: 100,
          prefix: filename
        };

        if (startFileId) {
          listBody.startFileId = startFileId;
        }

        const listResp = await fetch(`${authData.apiUrl}/b2api/v2/b2_list_file_versions`, {
          method: "POST",
          headers: {
            Authorization: authData.authorizationToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(listBody)
        });

        if (!listResp.ok) {
          const errText = await listResp.text();
          errors.push(`Failed to list versions for ${filename}: ${errText}`);
          keepPaging = false;
          break;
        }

        const listData = await listResp.json();

        if (!listData.files || listData.files.length === 0) {
          keepPaging = false;
          break;
        }

        for (const f of listData.files) {
          if (f.fileName === filename) {
            allVersions.push({ fileName: f.fileName, fileId: f.fileId });
          }
        }

        if (listData.nextFileName && listData.nextFileId) {
          if (listData.nextFileName === filename) {
            startFileName = listData.nextFileName;
            startFileId = listData.nextFileId;
          } else {
            keepPaging = false;
          }
        } else {
          keepPaging = false;
        }
      }

      if (allVersions.length === 0) {
        console.log(`File not found in B2: ${filename}`);
        continue;
      }

      console.log(`🗑️ Deleting ${allVersions.length} version(s) of: ${filename}`);

      for (const version of allVersions) {
        const deleteResp = await fetch(`${authData.apiUrl}/b2api/v2/b2_delete_file_version`, {
          method: "POST",
          headers: {
            Authorization: authData.authorizationToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fileName: version.fileName,
            fileId: version.fileId
          })
        });

        if (deleteResp.ok) {
          deletedCount++;
          console.log(`✅ Deleted version ${version.fileId}`);
        } else {
          const errorText = await deleteResp.text();
          errors.push(`Failed to delete version ${version.fileId}: ${errorText}`);
        }
      }
    } catch (err) {
      errors.push(`Error deleting ${url}: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    deleted: deletedCount,
    errors: errors.length > 0 ? errors : undefined
  };
}

async function deleteProductWithImages(productId, env) {
  try {
    const productResp = await fetch(`${SUPABASE_REST_PRODUCTS}?id=eq.${productId}&select=id,name,images`, {
      headers: svcHeaders(env)
    });
    if (!productResp.ok) return { success: false, error: 'Failed to fetch product' };
    
    const products = await productResp.json();
    if (!products || products.length === 0) return { success: false, error: 'Product not found' };
    
    const product = products[0];

    if (product.images && product.images.length > 0) {
      const deleteResult = await deleteImagesFromB2(product.images, env);
      if (deleteResult.errors) console.warn('Some images failed to delete:', deleteResult.errors);
    }

    const deleteResp = await fetch(`${SUPABASE_REST_PRODUCTS}?id=eq.${productId}`, {
      method: 'DELETE',
      headers: svcHeaders(env),
    });
    
    if (!deleteResp.ok) return { success: false, error: 'Failed to delete product' };

    return { success: true, productName: product.name };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ========================
// AUTH MIDDLEWARE
// ========================
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env);
  if (!payload) return null;
  return payload;
}

// ========================
// SCHEDULED TASK: Ad Expiry & Cleanup
// ========================
async function handleScheduledTask(env) {
  console.log("Starting scheduled ad expiry and cleanup task...");
  const serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    console.error("SUPABASE_SERVICE_KEY missing");
    return { success: false, error: "Missing service key" };
  }
  
  try {
    const now = new Date().toISOString();

    // Demote expired paid ads to free
    const demoteResponse = await fetch(
      `${SUPABASE_REST_PRODUCTS}?ad_type=neq.free&expires_at=lt.${now}&status=eq.approved&select=id,ad_type,expires_at`,
      { headers: svcHeaders(env) }
    );
    
    if (demoteResponse.ok) {
      const expiredPaidAds = await demoteResponse.json();
      if (expiredPaidAds && expiredPaidAds.length > 0) {
        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + 30);
        
        for (const ad of expiredPaidAds) {
          await fetch(`${SUPABASE_REST_PRODUCTS}?id=eq.${ad.id}`, {
            method: 'PATCH',
            headers: svcHeaders(env),
            body: JSON.stringify({
              ad_type: 'free',
              ad_price: 0,
              ad_duration: 30,
              is_featured: false,
              expires_at: newExpiry.toISOString()
            })
          });
        }
      }
    }

    // Delete expired free ads with images
    const deleteResponse = await fetch(
      `${SUPABASE_REST_PRODUCTS}?ad_type=eq.free&expires_at=lt.${now}&status=eq.approved&select=id,name,created_at,expires_at,images`,
      { headers: svcHeaders(env) }
    );
        if (deleteResponse.ok) {
      const expiredFreeAds = await deleteResponse.json();
      if (expiredFreeAds && expiredFreeAds.length > 0) {
        for (const ad of expiredFreeAds) {
          await deleteProductWithImages(ad.id, env);
        }
      }
    }

    console.log("Scheduled task completed");
    return { success: true, message: "Ad expiry and cleanup completed" };
  } catch (err) {
    console.error("Scheduled task error:", err);
    return { success: false, error: err.message };
  }
}

// ========================
// MAIN EXPORT
// ========================
export default {
  async scheduled(evt, env, ctx) {
    ctx.waitUntil(handleScheduledTask(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Health check
    if (pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ========================
    // ⭐ GET APPROVED PRODUCTS (PUBLIC - NO AUTH REQUIRED)
    // GET /api/get-products
    // Returns cached list of approved products
    // ========================
    if (pathname === '/api/get-products' && request.method === 'GET') {
      try {
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), { method: 'GET' });
        
        // Check Cloudflare cache first
        let cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          console.log('📦 Returning cached products (10 min cache)');
          return new Response(cachedResponse.body, {
            ...cachedResponse,
            headers: {
              ...cachedResponse.headers,
              'X-Cache': 'HIT',
              'Cache-Control': 'public, max-age=600',
              'content-type': 'application/json'
            }
          });
        }

        // Fetch approved products from Supabase (only if cache miss)
        const prodResp = await fetch(
          `${SUPABASE_REST_PRODUCTS}?status=eq.approved&select=id,name,price,images,location,category,description,condition,installment,negotiable,phone,user_id,ad_type,is_featured,featured_until,boosted_at,boosted_until,ad_duration,created_at,users(id,full_name,avatar_url,is_verified,last_active,created_at)&order=created_at.desc`,
          { headers: svcHeaders(env) }
        );

        if (!prodResp.ok) {
          return new Response(JSON.stringify({ error: 'Failed to fetch products' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        const products = await prodResp.json();

        // Transform product.images to use /images/ proxy paths
        const productsWithProxyUrls = (products || []).map(product => {
          if (product.images && Array.isArray(product.images) && product.images.length > 0) {
            const proxyImages = product.images.map((imgUrl) => {
              // Ensure all images are requested through /images/ proxy
              if (typeof imgUrl === 'string') {
                if (imgUrl.startsWith('/images/')) {
                  return imgUrl; // Already in proxy format
                } else if (imgUrl.includes('products/')) {
                  // Extract filename and use proxy
                  const filename = imgUrl.split('products/')[1];
                  return `/images/products/${filename}`;
                }
              }
              return imgUrl; // Keep avatars/external URLs as-is
            });
            return { ...product, images: proxyImages };
          }
          return product;
        });

        // Build response
        const responseBody = JSON.stringify(productsWithProxyUrls);
        const cacheResponse = new Response(responseBody, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'Cache-Control': `public, max-age=${PRODUCT_CACHE_TTL}`,
            'X-Cache': 'MISS'
          }
        });

        // Store in Cloudflare cache (10 minutes)
        ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));

        return new Response(responseBody, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'Cache-Control': `public, max-age=${PRODUCT_CACHE_TTL}`,
            'X-Cache': 'MISS'
          }
        });

      } catch (err) {
        console.error('Error in /api/get-products:', err);
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // AUTH: REGISTER
    // POST /api/register
    // body: { phone, password, full_name? }
    // ========================
    if (pathname === '/api/register' && request.method === 'POST') {
      try {
        const body = await request.json();
        const phone = sanitizePhone(body.phone);
        const password = body.password;
        const full_name = body.full_name ? sanitizeName(body.full_name) : null;

        if (!phone) {
          return new Response(JSON.stringify({ error: 'Invalid phone format. Must be +2567XXXXXXXX' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Validate password
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
          return new Response(JSON.stringify({ error: passwordValidation.error }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Check existing user
        const existing = await getUserByPhone(phone, env);
        if (existing) {
          return new Response(JSON.stringify({ error: 'User already exists' }), {
            status: 409,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Hash password
        const password_hash = await hashPassword(password);

        // Insert user
        const insertResp = await fetch(SUPABASE_REST_USERS, {
          method: 'POST',
          headers: svcHeaders(env),
          body: JSON.stringify([{
            phone,
            password_hash,
            full_name,
            role: 'user',
            created_at: new Date().toISOString()
          }])
        });

        if (!insertResp.ok) {
          const txt = await insertResp.text();
          return new Response(JSON.stringify({ error: 'Failed to create user', details: txt }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // AUTH: LOGIN
    // POST /api/login
    // body: { phone, password }
    // returns { token, user: {...} }
    // ========================
    if (pathname === '/api/login' && request.method === 'POST') {
      try {
        const { phone, password } = await request.json();
        
        if (!phone || !password) {
          return new Response(JSON.stringify({ error: 'Phone and password required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const user = await getUserByPhone(phone, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const storedHash = user.password_hash || user.password || null;
        if (!storedHash) {
          return new Response(JSON.stringify({ error: 'Password migration required' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        const ok = await verifyPassword(password, storedHash);
        if (!ok) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Build safe user object
        const safeUser = { ...user };
        delete safeUser.password;
        delete safeUser.password_hash;

        // Issue JWT
        const token = await signJWT({ userId: user.id, role: (user.role || 'user') }, env);

        return new Response(JSON.stringify({ token, user: safeUser }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // AUTH: GET CURRENT USER
    // GET /api/me
    // ========================
    if (pathname === '/api/me' && request.method === 'GET') {
      const payload = await requireAuth(request, env);
      if (!payload) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }

      const user = await getUserById(payload.userId, env);
      if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }

      delete user.password;
      delete user.password_hash;
      
      return new Response(JSON.stringify({ user }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ========================
    // AUTH: UPDATE PROFILE (name, phone, avatar — NOT password)
    // POST /api/update-profile
    // body: { full_name?, phone?, avatar_url? }
    // ========================
    if (pathname === '/api/update-profile' && request.method === 'POST') {
      try {
        const payload = await requireAuth(request, env);
        if (!payload) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const body = await request.json();
        const updates = {};

        // Sanitize and validate fields
        if (body.full_name) {
          const sanitized = sanitizeName(body.full_name);
          if (!sanitized) {
            return new Response(JSON.stringify({ error: 'Invalid name format' }), {
              status: 400,
              headers: { 'content-type': 'application/json' }
            });
          }
          updates.full_name = sanitized;
        }

        if (body.phone) {
          const sanitized = sanitizePhone(body.phone);
          if (!sanitized) {
            return new Response(JSON.stringify({ error: 'Invalid phone format' }), {
              status: 400,
              headers: { 'content-type': 'application/json' }
            });
          }
          // Check if phone already taken by another user
          const existing = await getUserByPhone(sanitized, env);
          if (existing && existing.id !== payload.userId) {
            return new Response(JSON.stringify({ error: 'Phone already in use' }), {
              status: 409,
              headers: { 'content-type': 'application/json' }
            });
          }
          updates.phone = sanitized;
        }

        if (body.avatar_url && typeof body.avatar_url === 'string') {
          updates.avatar_url = body.avatar_url;
        }

        // Prevent password change through this endpoint
        if (body.password || body.password_hash) {
          return new Response(JSON.stringify({ error: 'Use /api/change-password endpoint for password changes' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (Object.keys(updates).length === 0) {
          return new Response(JSON.stringify({ error: 'No valid fields to update' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        updates.updated_at = new Date().toISOString();

        const updateResp = await fetch(`${SUPABASE_REST_USERS}?id=eq.${payload.userId}`, {
          method: 'PATCH',
          headers: { ...svcHeaders(env), 'Prefer': 'return=representation' },
          body: JSON.stringify(updates)
        });

        if (!updateResp.ok) {
          const txt = await updateResp.text();
          return new Response(JSON.stringify({ error: 'Failed to update profile', details: txt }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        const updated = await updateResp.json();
        const user = updated[0] || {};
        delete user.password;
        delete user.password_hash;

        return new Response(JSON.stringify({ success: true, user }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // AUTH: CHANGE PASSWORD (secure endpoint with proper hashing)
    // POST /api/change-password
    // body: { currentPassword, newPassword }
    // ========================
    if (pathname === '/api/change-password' && request.method === 'POST') {
      try {
        const payload = await requireAuth(request, env);
        if (!payload) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const body = await request.json();
        const { currentPassword, newPassword } = body;

        if (!currentPassword || !newPassword) {
          return new Response(JSON.stringify({ error: 'Current and new passwords required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (currentPassword === newPassword) {
          return new Response(JSON.stringify({ error: 'New password must be different from current' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Validate new password
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
          return new Response(JSON.stringify({ error: passwordValidation.error }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Fetch current user
        const user = await getUserById(payload.userId, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Verify current password
        const storedHash = user.password_hash || user.password || null;
        if (!storedHash) {
          return new Response(JSON.stringify({ error: 'Password migration required' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        const passwordMatch = await verifyPassword(currentPassword, storedHash);
        if (!passwordMatch) {
          return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Hash new password
        const newPasswordHash = await hashPassword(newPassword);

        // Update password
        const updateResp = await fetch(`${SUPABASE_REST_USERS}?id=eq.${payload.userId}`, {
          method: 'PATCH',
          headers: svcHeaders(env),
          body: JSON.stringify({
            password_hash: newPasswordHash,
            updated_at: new Date().toISOString()
          })
        });

        if (!updateResp.ok) {
          const txt = await updateResp.text();
          return new Response(JSON.stringify({ error: 'Failed to update password', details: txt }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, message: 'Password changed successfully' }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // ADMIN: RESET PASSWORD
    // POST /api/admin/reset-password
    // ========================
    if (pathname === '/api/admin/reset-password' && request.method === 'POST') {
      const payload = await requireAuth(request, env);
      if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      
      try {
        const { userId, newPassword } = await request.json();
        if (!userId || !newPassword) {
          return new Response(JSON.stringify({ error: 'userId and newPassword required' }), { status: 400 });
        }

        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
          return new Response(JSON.stringify({ error: passwordValidation.error }), { status: 400 });
        }

        const hashed = await hashPassword(newPassword);
        const updateResp = await fetch(`${SUPABASE_REST_USERS}?id=eq.${userId}`, {
          method: 'PATCH',
          headers: svcHeaders(env),
          body: JSON.stringify({ password_hash: hashed })
        });

        if (!updateResp.ok) {
          const txt = await updateResp.text();
          return new Response(JSON.stringify({ error: 'Failed to reset password', details: txt }), { status: 500 });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ========================
    // ADMIN: UNVERIFY USER
    // POST /api/admin/unverify-user
    // ========================
    if (pathname === '/api/admin/unverify-user' && request.method === 'POST') {
      const payload = await requireAuth(request, env);
      if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      
      try {
        const { userId } = await request.json();
        if (!userId) {
          return new Response(JSON.stringify({ error: 'userId required' }), { status: 400 });
        }

        const updateResp = await fetch(`${SUPABASE_REST_USERS}?id=eq.${userId}`, {
          method: 'PATCH',
          headers: svcHeaders(env),
          body: JSON.stringify({ is_verified: false })
        });
        if (!updateResp.ok) {
          const txt = await updateResp.text();
          return new Response(JSON.stringify({ error: 'Failed to unverify user', details: txt }), { status: 500 });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }
    
    // ========================
    // ADMIN: VERIFY USER
    // POST /api/admin/verify-user
    // ========================
    if (pathname === '/api/admin/verify-user' && request.method === 'POST') {
      const payload = await requireAuth(request, env);
      if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      
      try {
        const { userId } = await request.json();
        if (!userId) {
          return new Response(JSON.stringify({ error: 'userId required' }), { status: 400 });
        }

        const updateResp = await fetch(`${SUPABASE_REST_USERS}?id=eq.${userId}`, {
          method: 'PATCH',
          headers: svcHeaders(env),
          body: JSON.stringify({ is_verified: true })
        });

        if (!updateResp.ok) {
          const txt = await updateResp.text();
          return new Response(JSON.stringify({ error: 'Failed to verify user', details: txt }), { status: 500 });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ========================
    // ADMIN: DELETE USER PERMANENTLY
    // POST /api/admin/delete-user
    // ========================
    if (pathname === '/api/admin/delete-user' && request.method === 'POST') {
      const payload = await requireAuth(request, env);
      if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      
      try {
        const { userId } = await request.json();
        if (!userId) {
          return new Response(JSON.stringify({ error: 'userId required' }), { status: 400 });
        }

        const user = await getUserById(userId, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
        }

        // Delete all user products
        const prodResp = await fetch(`${SUPABASE_REST_PRODUCTS}?user_id=eq.${userId}&select=id`, {
          headers: svcHeaders(env)
        });
        
        if (prodResp.ok) {
          const products = await prodResp.json();
          for (const prod of products) {
            await deleteProductWithImages(prod.id, env);
          }
        }

        // Delete user record
        const deleteResp = await fetch(`${SUPABASE_REST_USERS}?id=eq.${userId}`, {
          method: 'DELETE',
          headers: svcHeaders(env)
        });

        if (!deleteResp.ok) {
          const txt = await deleteResp.text();
          return new Response(JSON.stringify({ error: 'Failed to delete user', details: txt }), { status: 500 });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // ========================
    // CREATE PRODUCT
    // POST /api/create-product
    // ========================
    if (pathname === '/api/create-product' && request.method === 'POST') {
      try {
        const payload = await requireAuth(request, env);
        if (!payload) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const body = await request.json();
        if (!body.listing) {
          return new Response(JSON.stringify({ error: 'listing object required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const cleanListing = sanitizeProductFields(body.listing);
        cleanListing.user_id = payload.userId;
        cleanListing.status = 'pending';
        cleanListing.admin_approved = false;
        cleanListing.created_at = new Date().toISOString();

        if (!cleanListing.name || !cleanListing.category || !cleanListing.price) {
          return new Response(JSON.stringify({ error: 'name, category and price are required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const insertResp = await fetch(SUPABASE_REST_PRODUCTS, {
          method: 'POST',
          headers: { ...svcHeaders(env), 'Prefer': 'return=representation' },
          body: JSON.stringify([cleanListing])
        });

        if (!insertResp.ok) {
          const txt = await insertResp.text();
          return new Response(JSON.stringify({ error: 'Failed to create product', details: txt }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }
        const created = await insertResp.json();
        return new Response(JSON.stringify({ success: true, product: created[0] || null }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // UPDATE PRODUCT
    // POST /api/update-product
    // ========================
    if (pathname === '/api/update-product' && request.method === 'POST') {
      try {
        const payload = await requireAuth(request, env);
        if (!payload) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const body = await request.json();
        const { productId, updates } = body;

        if (!productId || !updates) {
          return new Response(JSON.stringify({ error: 'productId and updates required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Fetch current product
        const prodResp = await fetch(
          `${SUPABASE_REST_PRODUCTS}?id=eq.${productId}&select=user_id,status,admin_approved`,
          {
            headers: svcHeaders(env)
          }
        );
        
        if (!prodResp.ok) {
          return new Response(JSON.stringify({ error: 'Failed to fetch product' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }
        
        const prodArr = await prodResp.json();
        if (!prodArr || prodArr.length === 0) {
          return new Response(JSON.stringify({ error: 'Product not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        const currentProduct = prodArr[0];
        const ownerId = currentProduct.user_id;
        if (ownerId !== payload.userId && payload.role !== 'admin') {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          });
        }

        const cleanUpdates = sanitizeProductFields(updates);

        // ================= SMART STATUS LOGIC =================
        /**
         * FIX: Only "edited listings" should appear if the listing was ALREADY APPROVED
         * 
         * RULES:
         * 1. User edits APPROVED listing → status = "edited" (needs re-approval)
         * 2. User edits PENDING listing → status stays "pending" (no editing new listings)
         * 3. Admin approves → don't change status (keep as "approved")
         */
        
        if (payload.role === 'admin') {
          // ✅ Admin is updating (approving) - preserve whatever the current status is
          cleanUpdates.status = updates.status || 'approved';
          cleanUpdates.admin_approved = true;
          cleanUpdates.approved_at = cleanUpdates.approved_at || new Date().toISOString();
          
        } else {
          // 👤 User is updating their listing
          if (currentProduct.status === 'approved') {
            // User is editing an ALREADY-APPROVED listing → send to edited queue for re-approval
            cleanUpdates.status = 'edited';
            
          } else if (currentProduct.status === 'pending') {
            // User is editing a PENDING (new) listing → keep it pending
            cleanUpdates.status = 'pending';
          } else {
            // Default: keep current status
            cleanUpdates.status = currentProduct.status;
          }
        }

        cleanUpdates.updated_at = new Date().toISOString();

        const updateResp = await fetch(`${SUPABASE_REST_PRODUCTS}?id=eq.${productId}`, {
          method: 'PATCH',
          headers: { ...svcHeaders(env), 'Prefer': 'return=representation' },
          body: JSON.stringify(cleanUpdates)
        });

        if (!updateResp.ok) {
          const txt = await updateResp.text();
          return new Response(JSON.stringify({ error: 'Failed to update product', details: txt }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        const updated = await updateResp.json();
        return new Response(JSON.stringify({ success: true, product: updated[0] || null }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // DELETE IMAGES
    // POST /api/delete-images
    // ========================
    if (pathname === '/api/delete-images' && request.method === 'POST') {
      try {
        const payload = await requireAuth(request, env);
        if (!payload) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const body = await request.json();
        const { images, productId } = body;
        
        if (!images || !Array.isArray(images)) {
          return new Response(JSON.stringify({ error: 'images array required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (productId) {
          const prodResp = await fetch(`${SUPABASE_REST_PRODUCTS}?id=eq.${productId}&select=user_id`, {
            headers: svcHeaders(env)
          });
          
          if (!prodResp.ok) {
            return new Response(JSON.stringify({ error: 'Failed to fetch product' }), {
              status: 500,
              headers: { 'content-type': 'application/json' }
            });
          }
          
          const prodArr = await prodResp.json();
          if (!prodArr || prodArr.length === 0) {
            return new Response(JSON.stringify({ error: 'Product not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' }
            });
          }
          
          const ownerId = prodArr[0].user_id;
          if (ownerId !== payload.userId && payload.role !== 'admin') {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
              status: 403,
              headers: { 'content-type': 'application/json' }
            });
          }
        }

        const result = await deleteImagesFromB2(images, env);
        return new Response(JSON.stringify(result), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // DELETE PRODUCT
    // POST /api/delete-product
    // ========================
    if (pathname === '/api/delete-product' && request.method === 'POST') {
      try {
        const payload = await requireAuth(request, env);
        if (!payload) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const { productId } = await request.json();
        if (!productId) {
          return new Response(JSON.stringify({ error: 'productId required' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const prodResp = await fetch(`${SUPABASE_REST_PRODUCTS}?id=eq.${productId}&select=user_id`, {
          headers: svcHeaders(env)
        });
        
        if (!prodResp.ok) {
          return new Response(JSON.stringify({ error: 'Failed to fetch product' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }
        
        const prodArr = await prodResp.json();
        if (!prodArr || prodArr.length === 0) {
          return new Response(JSON.stringify({ error: 'Product not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }
        
        const ownerId = prodArr[0].user_id;
        if (ownerId !== payload.userId && payload.role !== 'admin') {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          });
        }

        const result = await deleteProductWithImages(productId, env);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // UPLOAD IMAGE
    // POST /api/upload-image
    // ========================
    if (pathname === '/api/upload-image' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file || !file.type.startsWith('image/')) {
          return new Response(JSON.stringify({ error: 'Invalid file' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const authData = await getB2Auth(env);
        const uploadUrlResp = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
          method: "POST",
          headers: {
            Authorization: authData.authorizationToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ bucketId: env.B2_BUCKET_ID })
        });
        
        if (!uploadUrlResp.ok) throw new Error('Failed to get upload URL');
        
        const uploadData = await uploadUrlResp.json();
        const filename = `products/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.webp`;
        const buffer = await file.arrayBuffer();

        const uploadResp = await fetch(uploadData.uploadUrl, {
          method: "POST",
          headers: {
            Authorization: uploadData.authorizationToken,
            "X-Bz-File-Name": encodeURIComponent(filename),
            "Content-Type": file.type,
            "X-Bz-Content-Sha1": "do_not_verify"
          },
          body: buffer
        });

        if (!uploadResp.ok) {
          const text = await uploadResp.text();
          return new Response(JSON.stringify({ error: 'Upload failed', details: text }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, url: `/images/${filename}` }), {
          headers: { 'content-type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // 🖼️ IMAGE PROXY - FIXED & WORKING
    // GET /images/<path>
    // ✅ Correctly serves images from private B2 bucket
    // ✅ Uses proper B2 download endpoint
    // ✅ Full error handling & debugging
    // ========================
    if (pathname.startsWith('/images/')) {
      const cache = caches.default;
      
      try {
        // Extract file path
        const filePath = pathname.replace('/images/', '');
        
        // Validate file path (prevent directory traversal)
        if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
          console.error('❌ [IMG] Invalid file path:', filePath);
          return new Response(JSON.stringify({ 
            error: 'Invalid file path',
            path: filePath
          }), { 
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        console.log(`📸 [IMG] Proxy request: ${filePath}`);
        
        // Check cache first
        let cachedResponse = await cache.match(request);
        if (cachedResponse) {
          console.log(`✅ [IMG] Cache HIT: ${filePath}`);
          return new Response(cachedResponse.body, {
            ...cachedResponse,
            headers: {
              ...cachedResponse.headers,
              'X-Cache': 'HIT'
            }
          });
        }

        // Get B2 authentication
        let authData;
        try {
          authData = await getB2Auth(env);
          console.log(`✅ [IMG] B2 auth successful`);
        } catch (authErr) {
          console.error(`❌ [IMG] B2 auth failed: ${authErr.message}`);
          return new Response(JSON.stringify({ 
            error: 'B2 authentication failed',
            details: authErr.message
          }), { 
            status: 503,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Extract bucket name from B2 response or from env
        // The downloadUrl from B2 auth looks like: https://fXXX.backblazeb2.com
        const downloadUrl = authData.downloadUrl;
        const bucketName = env.B2_BUCKET || 'tesatiki-products'; // IMPORTANT: set B2_BUCKET in env
        
        // Construct the proper B2 download URL
        // Format: {downloadUrl}/file/{bucketName}/{fileName}
        const b2FileUrl = `${downloadUrl}/file/${bucketName}/${filePath}`;
        
        console.log(`🔗 [IMG] B2 URL: ${b2FileUrl}`);

        // Fetch the image directly from B2
        console.log(`📥 [IMG] Fetching from B2...`);
        let imageResp;
        try {
          imageResp = await fetch(b2FileUrl, {
            headers: {
              Authorization: authData.authorizationToken
            }
          });
          console.log(`📡 [IMG] B2 response: ${imageResp.status}`);
        } catch (fetchErr) {
          console.error(`❌ [IMG] Network error: ${fetchErr.message}`);
          return new Response(JSON.stringify({ 
            error: 'Network error fetching image',
            details: fetchErr.message
          }), { 
            status: 502,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Handle 404
        if (imageResp.status === 404) {
          console.error(`❌ [IMG] File not found: ${filePath}`);
          return new Response(JSON.stringify({ 
            error: 'Image not found',
            path: filePath
          }), { 
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }

        // Handle other errors
        if (!imageResp.ok) {
          const respText = await imageResp.text().catch(() => '');
          console.error(`❌ [IMG] B2 error ${imageResp.status}: ${respText}`);
          return new Response(JSON.stringify({ 
            error: 'Failed to retrieve image from B2',
            status: imageResp.status
          }), { 
            status: 502,
            headers: { 'content-type': 'application/json' }
          });
        }

        console.log(`✅ [IMG] Successfully fetched from B2`);

        // Build response
        const contentType = imageResp.headers.get('Content-Type') || 'application/octet-stream';
        const contentLength = imageResp.headers.get('Content-Length') || '';
        
        const response = new Response(imageResp.body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': contentLength,
            'Cache-Control': `public, max-age=${IMAGE_CACHE_TTL}, immutable`,
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
            'X-Cache': 'MISS',
            'X-Image-Path': filePath
          }
        });

        // Cache the response
        try {
          ctx.waitUntil(cache.put(request, response.clone()));
          console.log(`✅ [IMG] Cached: ${filePath}`);
        } catch (cacheErr) {
          console.warn(`⚠️ [IMG] Cache failed (non-critical): ${cacheErr.message}`);
        }

        console.log(`✅ [IMG] SUCCESS: Image ready for client: ${filePath}`);
        return response;

      } catch (err) {
        console.error(`❌ [IMG] CRITICAL: ${err.message}`);
        console.error(`   Stack: ${err.stack}`);
        return new Response(JSON.stringify({ 
          error: 'Internal server error',
          message: err.message
        }), { 
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // ========================
    // MANUAL SCHEDULED TRIGGER
    // POST /api/run-scheduled-task
    // ========================
    if (pathname === '/api/run-scheduled-task' && request.method === 'POST') {
      const result = await handleScheduledTask(env);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // Fallback
    return env.ASSETS.fetch(request);
  }
};
