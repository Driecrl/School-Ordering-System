const demoAccounts = {
  student: { id: '20260001', name: 'Juan Mercado', pin: '123456', role: 'student', temporary: true },
  staff: { id: 'QCUSTAFF01', name: 'Maria Santos', pin: '123456', role: 'staff', temporary: true },
};
const menuItems = [
  { id: 'chicken', name: 'Chicken rice bowl', category: 'Meals', description: 'Grilled chicken with steamed rice', priceCents: 9500, icon: 'meal' },
  { id: 'pancit', name: 'Pancit canton', category: 'Meals', description: 'Noodles with mixed vegetables', priceCents: 6500, icon: 'meal' },
  { id: 'sandwich', name: 'Veggie sandwich', category: 'Snacks', description: 'Fresh vegetables on soft bread', priceCents: 5500, icon: 'snack' },
  { id: 'turon', name: 'Turon', category: 'Snacks', description: 'Banana spring roll · 2 pieces', priceCents: 3000, icon: 'snack' },
  { id: 'gulaman', name: 'Iced gulaman', category: 'Drinks', description: 'Chilled house-made drink', priceCents: 2500, icon: 'drink' },
  { id: 'water', name: 'Bottled water', category: 'Drinks', description: 'Cold drinking water', priceCents: 2000, icon: 'drink' },
];
const state = { account: null, filter: 'All', cart: {}, orders: [] };
const money = cents => `₱${(cents / 100).toFixed(2)}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const foodIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 11h14v2a7 7 0 0 1-14 0zM4 10h16M8 7l1 2M12 6v3M16 7l-1 2"/></svg>';
let pendingAccount = null;

function setError(message) {
  const error = document.getElementById('auth-error');
  if (error) { error.textContent = message; error.classList.add('show'); }
}

function drawRoleChoice() {
  document.getElementById('auth-content').innerHTML = `
    <span class="eyebrow">WELCOME</span><h1>Sign in to order</h1>
    <p>Choose your account type to continue.</p>
    <div class="auth-choice">
      <button type="button" data-role="student">Student<small>Student number and PIN</small></button>
      <button type="button" data-role="staff">Canteen staff<small>Staff ID and PIN</small></button>
    </div>
    <div class="auth-demo"><b>Presentation demo</b><br>Student: ${demoAccounts.student.id} · PIN: ${demoAccounts.student.pin}<br>Staff: ${demoAccounts.staff.id} · PIN: ${demoAccounts.staff.pin}<br>Demo details only. Do not enter real student information.</div>`;
  document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => drawLogin(button.dataset.role)));
}

function drawLogin(role, errorMessage = '') {
  const account = demoAccounts[role];
  const label = role === 'student' ? 'Student number' : 'Staff ID';
  document.getElementById('auth-content').innerHTML = `
    <button type="button" class="auth-back" data-back>← Choose account type</button>
    <span class="eyebrow">${role === 'student' ? 'STUDENT SIGN IN' : 'STAFF SIGN IN'}</span>
    <h1>${role === 'student' ? 'Welcome, student' : 'Welcome, staff'}</h1>
    <p>Enter your ${label.toLowerCase()} and six-digit PIN.</p>
    <form id="login-form">
      <label class="auth-field">${label}<input name="accountNumber" autocomplete="username" inputmode="${role === 'student' ? 'numeric' : 'text'}" maxlength="80" required></label>
      <label class="auth-field">PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
      <div class="auth-error${errorMessage ? ' show' : ''}" id="auth-error" role="alert">${escapeHtml(errorMessage)}</div>
      <button class="auth-primary" type="submit">Continue</button>
    </form>
    <div class="auth-demo">Demo ${role === 'student' ? 'student number' : 'staff ID'}: <b>${account.id}</b> · ${account.temporary ? 'Temporary PIN' : 'Demo PIN'}: <b>${account.pin}</b></div>`;
  document.querySelector('[data-back]').addEventListener('click', drawRoleChoice);
  document.getElementById('login-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enteredId = form.get('accountNumber').trim().toUpperCase();
    const enteredPin = form.get('pin');
    if (enteredId !== account.id || enteredPin !== account.pin) return setError('That demo ID and PIN did not match.');
    pendingAccount = account;
    if (account.temporary) drawPinChange();
    else enterApp(account);
  });
}

function drawPinChange(errorMessage = '') {
  const account = pendingAccount;
  document.getElementById('auth-content').innerHTML = `
    <span class="eyebrow">FIRST SIGN IN</span><h1>Set your own PIN</h1>
    <p class="auth-intro">Create a new six-digit PIN for this presentation demo.</p>
    <div class="auth-success top">Demo account selected: ${escapeHtml(account.name)}.</div>
    <form id="pin-form">
      <label class="auth-field">New six-digit PIN<input id="new-pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
      <label class="auth-field">Confirm new PIN<input id="confirm-pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
      <div class="auth-error${errorMessage ? ' show' : ''}" id="auth-error" role="alert">${escapeHtml(errorMessage)}</div>
      <button class="auth-primary" type="submit">Save PIN and continue</button>
    </form>
    <button type="button" class="auth-secondary" id="cancel-pin">Sign out</button>`;
  document.getElementById('pin-form').addEventListener('submit', event => {
    event.preventDefault();
    const nextPin = document.getElementById('new-pin').value;
    const confirmPin = document.getElementById('confirm-pin').value;
    if (nextPin === account.pin) return setError('Choose a PIN different from the temporary PIN.');
    if (nextPin !== confirmPin) return setError('The PINs do not match.');
    if (/^(.)\1{5}$/.test(nextPin) || ['012345', '123456', '654321'].includes(nextPin)) return setError('Choose a less predictable six-digit PIN.');
    account.pin = nextPin;
    account.temporary = false;
    enterApp(account);
  });
  document.getElementById('cancel-pin').addEventListener('click', signOut);
}

function enterApp(account) {
  state.account = account;
  document.body.classList.remove('role-student', 'role-staff');
  document.body.classList.add(`role-${account.role}`);
  document.getElementById('auth-shell').hidden = true;
  document.getElementById('welcome-title').textContent = `Order ahead, ${account.name.split(' ')[0]}`;
  document.querySelector('.account').textContent = account.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelector('.account').setAttribute('aria-label', `Sign out ${account.name}`);
  const nextRoleLabel = account.role === 'student' ? 'Switch to staff' : 'Switch to student';
  document.querySelectorAll('.switch-account').forEach(button => { button.textContent = nextRoleLabel; });
  showScreen(account.role === 'staff' ? 'staff' : 'menu');
  drawOrders();
  drawStaff();
  if (account.role === 'student') {
    const readyOrder = state.orders.find(order => order.student === account.name && order.status === 'Ready for pickup' && !order.studentNotified);
    if (readyOrder) {
      readyOrder.studentNotified = true;
      notify(`Your order ${readyOrder.id} is ready for pickup.`);
    }
  }
}

function signOut() {
  state.account = null;
  state.cart = {};
  pendingAccount = null;
  document.body.classList.remove('role-student', 'role-staff');
  document.getElementById('auth-shell').hidden = false;
  drawCart();
  drawOrders();
  drawStaff();
  drawRoleChoice();
}

function switchAccount() {
  if (!state.account) return;
  const nextAccount = demoAccounts[state.account.role === 'student' ? 'staff' : 'student'];
  if (nextAccount.temporary) {
    pendingAccount = nextAccount;
    document.getElementById('auth-shell').hidden = false;
    drawPinChange();
    return;
  }
  enterApp(nextAccount);
  notify(`Switched to ${nextAccount.role} demo.`);
}

function drawMenu() {
  const shown = menuItems.filter(item => state.filter === 'All' || item.category === state.filter);
  document.getElementById('food-list').innerHTML = shown.map(item => `
    <article class="food"><div class="food-art ${item.icon}" aria-hidden="true">${foodIcon}</div>
      <div class="food-info"><h3>${item.name}</h3><p>${item.description}</p>
        <div class="food-meta"><div><span class="price">${money(item.priceCents)}</span><span class="stock">Available</span></div>
          <button class="add" data-add="${item.id}" aria-label="Add ${item.name} to your order">+</button></div>
      </div></article>`).join('');
  document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => addItem(button.dataset.add)));
}

function cartQuantity() { return Object.values(state.cart).reduce((total, count) => total + count, 0); }
function cartTotal() {
  return Object.entries(state.cart).reduce((total, [id, count]) => total + menuItems.find(item => item.id === id).priceCents * count, 0);
}
function addItem(id) {
  if (state.cart[id] >= 10) return notify('Maximum 10 per menu item.');
  state.cart[id] = (state.cart[id] || 0) + 1;
  drawCart();
}
function changeQuantity(id, amount) {
  const next = (state.cart[id] || 0) + amount;
  if (next > 10) return notify('Maximum 10 per menu item.');
  if (next < 1) delete state.cart[id]; else state.cart[id] = next;
  drawCart();
}
function drawCart() {
  const quantity = cartQuantity();
  document.getElementById('cart-open').disabled = !quantity;
  document.getElementById('cart-label').textContent = quantity ? `${quantity} ${quantity === 1 ? 'item' : 'items'} · View order` : 'Your order is empty';
  document.getElementById('cart-total').textContent = money(cartTotal());
  document.getElementById('sheet-total').textContent = money(cartTotal());
  document.getElementById('cart-lines').innerHTML = Object.entries(state.cart).map(([id, count]) => {
    const item = menuItems.find(entry => entry.id === id);
    return `<div class="cart-row"><div><strong>${item.name}</strong><small>${money(item.priceCents)} each</small></div>
      <div class="quantity"><button data-change="${id}" data-amount="-1" aria-label="Remove one ${item.name}">−</button><span>${count}</span><button data-change="${id}" data-amount="1" aria-label="Add one ${item.name}">+</button></div></div>`;
  }).join('');
  document.querySelectorAll('[data-change]').forEach(button => button.addEventListener('click', () => changeQuantity(button.dataset.change, Number(button.dataset.amount))));
  document.getElementById('place-order').disabled = !quantity;
}

function orderLines(order) { return order.items.map(item => `${item.quantity} × ${item.name}`).join(', '); }
function orderTime(order) { return new Date(order.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function statusIndicator(status) {
  const stages = ['Received', 'Preparing', 'Ready for pickup'];
  const current = stages.indexOf(status);
  return `<div class="stepper" aria-label="Order progress">${stages.map((stage, index) => `<div class="step ${index <= current ? 'done' : ''} ${index === current ? 'current' : ''}"><div class="step-dot" aria-hidden="true"></div>${stage}</div>`).join('')}</div>`;
}
function drawOrders() {
  const target = document.getElementById('order-list');
  const studentOrders = state.orders.filter(order => !state.account || order.student === state.account.name);
  target.innerHTML = studentOrders.length ? [...studentOrders].reverse().map(order => `
    <article class="order-card"><div class="order-top"><div><div class="order-name">${escapeHtml(orderLines(order))}</div><span class="order-id">${order.id} · ${orderTime(order)}</span></div>
      <span class="badge${order.status === 'Ready for pickup' ? ' ready' : ''}">${order.status}</span></div>${statusIndicator(order.status)}
      <div class="order-detail">Total <strong>${money(order.totalCents)}</strong> · Cash at pickup</div>
      <div class="pickup-note">${order.status === 'Ready for pickup' ? '🔔 Your order is ready! Please collect it at the QCU Canteen counter.' : 'Pickup at the QCU Canteen counter when your order is ready.'}</div></article>`).join('') : '<div class="empty">Your placed orders will show here.</div>';
}
function drawStaff() {
  const counts = ['Received', 'Preparing', 'Ready for pickup'];
  document.getElementById('received-count').textContent = state.orders.filter(order => order.status === counts[0]).length;
  document.getElementById('preparing-count').textContent = state.orders.filter(order => order.status === counts[1]).length;
  document.getElementById('ready-count').textContent = state.orders.filter(order => order.status === counts[2]).length;
  const target = document.getElementById('staff-list');
  target.innerHTML = state.orders.length ? [...state.orders].reverse().map(order => `
    <article class="staff-order"><div class="staff-order-head"><div><h3>${order.id}</h3><small>${orderTime(order)} · ${escapeHtml(order.student)}</small></div>
      <span class="badge${order.status === 'Ready for pickup' ? ' ready' : ''}">${order.status}</span></div>
      <div class="staff-items">${escapeHtml(orderLines(order))}<br><strong>${money(order.totalCents)}</strong> · Cash at pickup</div>
      <div class="staff-actions"><span class="note compact">Pickup order</span>${order.status === 'Ready for pickup'
        ? '<button class="action secondary" disabled>Ready for pickup</button>'
        : `<button class="action" data-advance="${order.id}">${order.status === 'Received' ? 'Start preparing' : 'Mark ready'}</button>`}</div></article>`).join('') : '<div class="empty">New student orders will appear here.</div>';
  document.querySelectorAll('[data-advance]').forEach(button => button.addEventListener('click', () => advanceOrder(button.dataset.advance)));
}
function advanceOrder(id) {
  const order = state.orders.find(item => item.id === id);
  order.status = order.status === 'Received' ? 'Preparing' : 'Ready for pickup';
  if (order.status === 'Ready for pickup') order.studentNotified = false;
  drawStaff();
  drawOrders();
}

function showScreen(name) {
  if (!state.account) return;
  if (state.account.role === 'student' && name === 'staff') return;
  if (state.account.role === 'staff' && name !== 'staff') return;
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${name}`));
  document.querySelectorAll('[data-screen]').forEach(button => {
    if (button.dataset.screen === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function notify(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2000);
}

document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.screen)));
document.querySelectorAll('[data-cat]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.cat;
  document.querySelectorAll('[data-cat]').forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
  drawMenu();
}));
document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', signOut));
document.querySelectorAll('.switch-account').forEach(button => button.addEventListener('click', switchAccount));
const veil = document.getElementById('cart-veil');
document.getElementById('cart-open').addEventListener('click', () => { veil.classList.add('open'); document.getElementById('cart-close').focus(); });
document.getElementById('cart-close').addEventListener('click', () => { veil.classList.remove('open'); document.getElementById('cart-open').focus(); });
veil.addEventListener('click', event => { if (event.target === veil) veil.classList.remove('open'); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') veil.classList.remove('open'); });
document.getElementById('place-order').addEventListener('click', () => {
  if (!cartQuantity()) return;
  const items = Object.entries(state.cart).map(([id, quantity]) => ({ name: menuItems.find(item => item.id === id).name, quantity, unitPriceCents: menuItems.find(item => item.id === id).priceCents }));
  state.orders.push({ id: `DEMO-${String(state.orders.length + 1).padStart(3, '0')}`, student: state.account.name, items, totalCents: cartTotal(), status: 'Received', createdAt: new Date() });
  state.cart = {};
  drawCart();
  drawOrders();
  drawStaff();
  veil.classList.remove('open');
  showScreen('orders');
  notify('Demo order placed. Pay cash at pickup.');
});

drawMenu();
drawCart();
drawOrders();
drawStaff();
drawRoleChoice();
