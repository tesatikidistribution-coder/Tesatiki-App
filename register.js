const form = document.getElementById('regForm');
const phoneInput = document.getElementById('phone');
const passInput = document.getElementById('pass');
const confirmInput = document.getElementById('confirmPass');
const btn = document.getElementById('btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Reset error messages
  document.querySelectorAll('.error-text').forEach(el => el.style.display = 'none');

  const phone = phoneInput.value.trim();
  const password = passInput.value;

  // Phone validation
  if (phone[0] !== '7' || phone.length !== 9) {
    document.getElementById('phoneError').style.display = 'block';
    return;
  }

  // Password match
  if (password !== confirmInput.value) {
    document.getElementById('matchError').style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerText = 'Creating account...';

  const fullPhone = '+256' + phone;

  try {
    // Call secure worker register endpoint
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: fullPhone,
        password: password
      })
    });

    const result = await res.json();

    if (!res.ok) {
      alert(result.error || result.message || result.details || 'Registration failed');
      return;
    }

    alert('Account created successfully!');
    window.location.href = 'login.html';

  } catch (err) {
    alert('Registration failed. Try again.');
    console.error(err); // Show real error in console
  } finally {
    btn.disabled = false;
    btn.innerText = 'Create Account';
  }
});