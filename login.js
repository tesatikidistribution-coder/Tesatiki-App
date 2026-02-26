// No need to import supabase anymore

const form = document.getElementById('loginForm');
const phoneInput = document.getElementById('phone');
const passInput = document.getElementById('pass');
const btn = document.getElementById('btn');

form.onsubmit = async (e) => {
  e.preventDefault();

  const phoneVal = phoneInput.value.trim();
  const password = passInput.value;
  const fullPhone = '+256' + phoneVal;
  const errorEl = document.getElementById('phoneError');

  // Phone validation
  if (phoneVal[0] !== '7' || phoneVal.length !== 9) {
    errorEl.style.display = 'block';
    return;
  } else {
    errorEl.style.display = 'none';
  }

  btn.disabled = true;
  btn.innerText = "Checking...";

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: fullPhone,
        password: password
      })
    });

    // Handle non-JSON responses safely
    let result;
    try {
      result = await res.json();
    } catch (jsonError) {
      console.error("Invalid JSON response from server:", jsonError);
      alert("Server error. Check console.");
      return;
    }

    console.log("Login Response Status:", res.status);
    console.log("Login Response Data:", result);

    if (!res.ok) {
      console.error("Server rejected login:", result);
      alert(result.message || "Invalid login credentials");
      return;
    }

    const user = result.user;

    if (!user) {
      console.error("No user returned from server.");
      alert("Login failed. No user data.");
      return;
    }

    // Ensure role exists
    user.role = user.role || 'user';

    // SECURITY: Save token under 'authToken' — this key is read by
    // sell.js, profile.js, and admin.js for all protected API calls
    if (result.token) {
      localStorage.setItem('authToken', result.token);
    }

    // Save safe user object
    localStorage.setItem('currentUser', JSON.stringify(user));
    console.log("Saved currentUser:", user);

    // Redirect based on role
    if (user.role === 'admin') {
      window.location.href = 'admin.html';
    } else {
      window.location.href = 'profile.html';
    }

  } catch (err) {
    console.error("Network / Fetch Error:", err);
    alert("Login failed. Check console for details.");
  } finally {
    btn.disabled = false;
    btn.innerText = "Sign In";
  }
};
