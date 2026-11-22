const state = { csrfToken: '', account: null, filter: 'All', menuItems: [], cart: {}, orders: [] };
const peso = cents => '₱' + (Number(cents) / 100).toFixed(2);
const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const foodIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 11h14v2a7 7 0 0 1-14 0zM4 10h16M8 7l1 2M12 6v3M16 7l-1 2"/></svg>';

async function request(url, { method = 'GET', body, csrf = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.account && !url.startsWith('/api/auth/')) {
      queueMicrotask(() => signOut());
    }
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

function showAuthError(message) {
  const el = document.getElementById('auth-error');
  if (el) {
    el.textContent = message;
    el.classList.add('show');
  }
}

function drawRoleChoice() {
  document.getElementById('auth-content').innerHTML = `
    <span class="eyebrow">WELCOME</span>
    <h1>Sign in to order</h1>
    <p>Choose your account type to continue.</p>
    <div class="auth-choice">
      <button type="button" data-role="student">Student<small>Use your student number and PIN</small></button>
      <button type="button" data-role="staff">Canteen staff<small>Use your staff ID and PIN</small></button>
    </div>
    <div class="auth-demo"><b>Real account access</b><br>Use the temporary PIN provided by canteen staff. Change it the first time you sign in.</div>`;
  document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => drawLogin(button.dataset.role)));
}

function drawLogin(role, errorMessage = '') {
  const label = role === 'student' ? 'Student number' : 'Staff ID';
  document.getElementById('auth-content').innerHTML = `
    <button type="button" class="auth-back" data-back>← Choose account type</button>
    <span class="eyebrow">${role === 'student' ? 'STUDENT SIGN IN' : 'STAFF SIGN IN'}</span>
    <h1>${role === 'student' ? 'Welcome, student' : 'Welcome, staff'}</h1>
    <p>Enter your ${label.toLowerCase()} and six-digit PIN.</p>
    <form id="login-form">
      <label class="auth-field">${label}<input id="login-id" name="accountNumber" autocomplete="username" inputmode="${role === 'student' ? 'numeric' : 'text'}" maxlength="80" required></label>
      <label class="auth-field">PIN<span class="pin-wrap"><input id="login-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" aria-describedby="pin-help" required></span></label>
      <div class="note" id="pin-help">Your name appears after your PIN is verified.</div>
      <div class="auth-error${errorMessage ? ' show' : ''}" id="auth-error" role="alert">${safe(errorMessage)}</div>
      <button class="auth-primary" type="submit">Continue</button>
    </form>
    <div class="auth-demo">Temporary PIN provided by canteen staff. If it has expired or you cannot sign in, ask staff to reset it.</div>`;
  document.querySelector('[data-back]').addEventListener('click', drawRoleChoice);
  document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountNumber = form.get('accountNumber').trim();
    const pin = form.get('pin');
    try {
      const account = await request('/api/auth/login', { method: 'POST', body: { accountNumber, pin }, csrf: true });
      state.csrfToken = account.csrfToken;
      state.account = account;
      if (account.mustChangePin) drawPinChange();
      else await enterApp(account);
    } catch (error) {
      showAuthError(error.message);
    }
  });
}

function drawPinChange(errorMessage = '') {
  const roleName = state.account.role === 'student' ? 'student' : 'staff';
  document.getElementById('auth-content').innerHTML = `
    <span class="eyebrow">FIRST SIGN IN</span>
    <h1>Set your own PIN</h1>
    <p class="auth-intro">Your ${roleName} account has a temporary PIN. Create a new six-digit PIN to continue.</p>
    <div class="auth-success top">Account verified for ${safe(state.account.name)}.</div>
    <form id="pin-form">
      <label class="auth-field">New six-digit PIN<input id="new-pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
      <label class="auth-field">Confirm new PIN<input id="confirm-pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
      <div class="auth-error${errorMessage ? ' show' : ''}" id="auth-error" role="alert">${safe(errorMessage)}</div>
      <button class="auth-primary" type="submit">Save PIN and continue</button>
    </form>
    <button type="button" class="auth-secondary" id="cancel-pin">Sign out</button>`;
  document.getElementById('pin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const newPin = document.getElementById('new-pin').value;
    const confirmPin = document.getElementById('confirm-pin').value;
    if (newPin !== confirmPin) return showAuthError('The PINs do not match. Please try again.');
    try {
      const account = await request('/api/auth/change-pin', { method: 'POST', body: { newPin }, csrf: true });
      state.csrfToken = account.csrfToken;
      state.account = account;
      await enterApp(account);
    } catch (error) {
      showAuthError(error.message);
    }
  });
  document.getElementById('cancel-pin').addEventListener('click', signOut);
}

function setRoleNavigation(role) {
  document.body.classList.remove('role-student', 'role-staff');
  document.body.classList.add(`role-${role}`);
}

async function enterApp(account) {
  state.account = account;
  setRoleNavigation(account.role);
  document.getElementById('auth-shell').hidden = true;
  const firstName = account.name.trim().split(/\s+/)[0];
  document.getElementById('welcome-title').textContent = `Order ahead, ${firstName}`;
  const initials = account.name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelector('.account').textContent = initials;
  document.querySelector('.account').setAttribute('aria-label', `Sign out ${account.name}`);
  showScreen(account.role === 'staff' ? 'staff' : 'menu');
  try {
    if (account.role === 'student') {
      state.menuItems = await request('/api/menu');
      drawMenu();
    }
  } catch (error) {
    announce(error.message);
  }
}

async function signOut() {
  try {
    await request('/api/auth/logout', { method: 'POST', csrf: true });
  } catch {
    // The local view still returns to sign-in if the session already expired.
  }
  try {
    const csrf = await request('/api/auth/csrf');
    state.csrfToken = csrf.csrfToken;
  } catch {
    state.csrfToken = '';
  }
  state.account = null;
  state.csrfToken = '';
  state.cart = {};
  state.orders = [];
  drawCart();
  drawOrders();
  drawStaff();
  document.body.classList.remove('role-student', 'role-staff');
  document.getElementById('auth-shell').hidden = false;
  drawRoleChoice();
}

function drawMenu() {
  const visible = state.menuItems.filter(item => state.filter === 'All' || item.category === state.filter);
  const target = document.getElementById('food-list');
  target.innerHTML = visible.length ? visible.map(item => `
    <article class="food">
      <div class="food-art ${safe(item.category.toLowerCase().slice(0, -1))}" aria-hidden="true">${foodIcon}</div>
      <div class="food-info"><h3>${safe(item.name)}</h3><p>${safe(item.description)}</p>
        <div class="food-meta"><div><span class="price">${peso(item.priceCents)}</span><span class="stock ${item.available ? '' : 'sold'}">${item.available ? 'Available' : 'Unavailable'}</span></div>
          <button class="add" data-add="${safe(item.id)}" aria-label="Add ${safe(item.name)} to your order" ${item.available ? '' : 'disabled'}>+</button>
        </div>
      </div>
    </article>`).join('') : '<div class="empty">No items in this category right now.</div>';
  target.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => addItem(button.dataset.add)));
}

function cartQty() {
  return Object.values(state.cart).reduce((sum, quantity) => sum + quantity, 0);
}

function cartSum() {
  return Object.entries(state.cart).reduce((sum, [id, quantity]) => {
    const item = state.menuItems.find(menuItem => menuItem.id === id);
    return sum + (item ? item.priceCents * quantity : 0);
  }, 0);
}

function addItem(id) {
  const item = state.menuItems.find(menuItem => menuItem.id === id);
  if (!item?.available) return;
  if ((state.cart[id] || 0) >= 10) return announce('Maximum 10 per menu item.');
  state.cart[id] = (state.cart[id] || 0) + 1;
  drawCart();
  announce(`${item.name} added to your order`);
}

function changeQty(id, change) {
  const next = (state.cart[id] || 0) + change;
  if (next > 10) return announce('Maximum 10 per menu item.');
  if (next <= 0) delete state.cart[id];
  else state.cart[id] = next;
  drawCart();
}

function drawCart() {
  const quantity = cartQty();
  const total = cartSum();
  document.getElementById('cart-open').disabled = !quantity;
  document.getElementById('cart-label').textContent = quantity ? `${quantity} ${quantity === 1 ? 'item' : 'items'} · View order` : 'Your order is empty';
  document.getElementById('cart-total').textContent = peso(total);
  document.getElementById('sheet-total').textContent = peso(total);
  document.getElementById('cart-lines').innerHTML = Object.entries(state.cart).map(([id, count]) => {
    const item = state.menuItems.find(menuItem => menuItem.id === id);
    if (!item) return '';
    return `<div class="cart-row"><div><strong>${safe(item.name)}</strong><small>${peso(item.priceCents)} each</small></div>
      <div class="quantity"><button data-qty="${safe(id)}" data-delta="-1" aria-label="Remove one ${safe(item.name)}">−</button><span aria-label="Quantity ${count}">${count}</span><button data-qty="${safe(id)}" data-delta="1" aria-label="Add one ${safe(item.name)}">+</button></div></div>`;
  }).join('');
  document.querySelectorAll('[data-qty]').forEach(button => button.addEventListener('click', () => changeQty(button.dataset.qty, Number(button.dataset.delta))));
}

function orderStatusClass(status) {
  return status === 'Ready for pickup' ? ' ready' : '';
}

function statusSteps(status) {
  const stages = ['Received', 'Preparing', 'Ready for pickup'];
  const index = stages.indexOf(status);
  return `<div class="stepper" aria-label="Order progress">${stages.map((stage, i) => `
    <div class="step ${i <= index ? 'done' : ''} ${i === index ? 'current' : ''}"><div class="step-dot" aria-hidden="true"></div>${stage}</div>`).join('')}</div>`;
}

function orderLines(order) {
  return order.items.map(item => `${item.quantity} × ${item.name}`).join(', ');
}

function orderTime(order) {
  return new Date(order.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function drawOrders() {
  const target = document.getElementById('order-list');
  target.innerHTML = state.orders.length ? state.orders.map(order => `
    <article class="order-card"><div class="order-top"><div><div class="order-name">${safe(orderLines(order))}</div><span class="order-id">${safe(order.id)} · ${safe(orderTime(order))}</span></div>
      <span class="badge${orderStatusClass(order.status)}">${safe(order.status)}</span></div>${statusSteps(order.status)}
      <div class="order-detail">Total <strong>${peso(order.totalCents)}</strong> · Cash at pickup</div>
      <div class="pickup-note">Pickup at the QCU Canteen counter when your order is ready.</div></article>`).join('') : '<div class="empty">Your placed orders will show here.</div>';
}

function drawStaff() {
  const counts = ['Received', 'Preparing', 'Ready for pickup'];
  document.getElementById('received-count').textContent = state.orders.filter(order => order.status === counts[0]).length;
  document.getElementById('preparing-count').textContent = state.orders.filter(order => order.status === counts[1]).length;
  document.getElementById('ready-count').textContent = state.orders.filter(order => order.status === counts[2]).length;
  const target = document.getElementById('staff-list');
  target.innerHTML = state.orders.length ? state.orders.map(order => `
    <article class="staff-order"><div class="staff-order-head"><div><h3>${safe(order.id)}</h3><small>${safe(orderTime(order))} · ${safe(order.student)}</small></div>
      <span class="badge${orderStatusClass(order.status)}">${safe(order.status)}</span></div>
      <div class="staff-items">${safe(orderLines(order))}<br><strong>${peso(order.totalCents)}</strong> · Cash at pickup</div>
      <div class="staff-actions"><span class="note compact">Pickup order</span>${order.status === 'Ready for pickup'
        ? '<button class="action secondary" disabled>Ready for pickup</button>'
        : `<button class="action" data-advance="${safe(order.id)}" data-status="${order.status === 'Received' ? 'Preparing' : 'Ready for pickup'}">${order.status === 'Received' ? 'Start preparing' : 'Mark ready'}</button>`}</div></article>`).join('') : '<div class="empty">New student orders will appear here.</div>';
  target.querySelectorAll('[data-advance]').forEach(button => button.addEventListener('click', () => advanceOrder(button.dataset.advance, button.dataset.status)));
}

async function refreshOrders() {
  state.orders = await request('/api/orders');
  drawOrders();
  drawStaff();
}

async function advanceOrder(id, status) {
  try {
    await request(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status }, csrf: true });
    await refreshOrders();
    announce(`Order updated: ${status}`);
  } catch (error) {
    announce(error.message);
  }
}

function announce(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function showScreen(name) {
  if (state.account?.role === 'student' && name === 'staff') return;
  if (state.account?.role === 'staff' && name !== 'staff') return;
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${name}`));
  document.querySelectorAll('[data-screen]').forEach(button => {
    const active = button.dataset.screen === name;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (name === 'orders' || name === 'staff') refreshOrders().catch(error => announce(error.message));
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.screen)));
document.querySelectorAll('[data-cat]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.cat;
  document.querySelectorAll('[data-cat]').forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
  drawMenu();
}));

const veil = document.getElementById('cart-veil');
const cartOpen = document.getElementById('cart-open');
const cartClose = document.getElementById('cart-close');
function closeCart() { veil.classList.remove('open'); cartOpen.focus(); }
cartOpen.addEventListener('click', () => { veil.classList.add('open'); cartClose.focus(); });
cartClose.addEventListener('click', closeCart);
veil.addEventListener('click', event => { if (event.target === veil) closeCart(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && veil.classList.contains('open')) closeCart(); });

document.getElementById('place-order').addEventListener('click', async () => {
  if (!cartQty()) return;
  const button = document.getElementById('place-order');
  button.disabled = true;
  try {
    await request('/api/orders', {
      method: 'POST',
      body: { items: Object.entries(state.cart).map(([id, quantity]) => ({ id, quantity })) },
      csrf: true,
    });
    state.cart = {};
    drawCart();
    closeCart();
    showScreen('orders');
    announce('Order placed. Pay cash at pickup.');
  } catch (error) {
    announce(error.message);
  } finally {
    button.disabled = !cartQty();
  }
});

document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', signOut));

async function start() {
  drawCart();
  drawOrders();
  drawStaff();
  try {
    const csrf = await request('/api/auth/csrf');
    state.csrfToken = csrf.csrfToken;
    const account = await request('/api/auth/me');
    state.account = account;
    if (account.mustChangePin) drawPinChange();
    else await enterApp(account);
  } catch (error) {
    drawRoleChoice();
  }
}

start();
