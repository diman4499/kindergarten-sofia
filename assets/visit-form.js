(() => {
  'use strict';
  const form = document.querySelector('#visit-form');
  if (!form) return;
  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector('#visit-status');
  const endpoint = window.VISIT_FORM_ENDPOINT || '';
  const ready = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint);
  let requestId = '';
  let sending = false;
  const phone = form.elements.phone;
  const checkPhone = () => {
    const digits = phone.value.replace(/\D/g, '');
    phone.setCustomValidity(digits.length >= 7 && digits.length <= 15 ? '' : 'Въведете телефон с 7–15 цифри.');
  };
  phone.addEventListener('input', checkPhone);
  const show = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };
  if (!ready) {
    show('Онлайн записването се подготвя. За посещение, моля, обадете се или ни пишете по имейл.', 'info');
    return;
  }
  button.disabled = false;
  show('', 'info');
  form.addEventListener('input', () => { if (!sending) requestId = ''; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    checkPhone();
    if (sending || !form.reportValidity()) return;
    sending = true;
    button.disabled = true;
    button.textContent = 'Изпращане…';
    show('Изпращаме Вашата заявка…', 'info');
    requestId ||= crypto.randomUUID();
    const payload = Object.fromEntries(new FormData(form));
    payload.requestId = requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal
      });
      if (!response.ok) throw new Error('HTTP error');
      const result = await response.json();
      if (result.ok !== true || result.requestId !== requestId) throw new Error('Unconfirmed');
      form.reset();
      requestId = '';
      show('Благодарим! Заявката Ви е получена. Ще се свържем с Вас за потвърждение на посещението.', 'success');
    } catch {
      show('Не успяхме да потвърдим получаването. Опитайте отново или се свържете с нас по телефона. Попълнените данни са запазени във формата.', 'error');
    } finally {
      clearTimeout(timeout);
      sending = false;
      button.disabled = false;
      button.textContent = 'Запази среща';
    }
  });
})();
