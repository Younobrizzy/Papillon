(function () {
  'use strict';
  const form = document.getElementById('puppy-contact-form');
  const summary = document.getElementById('contact-puppy-summary');
  const fallback = document.getElementById('contact-page-fallback');
  const loader = document.querySelector('.site-navigation-loader');
  const feedback = document.getElementById('puppy-contact-feedback');
  const submitButton = form?.querySelector('button[type="submit"]');
  const originalButton = submitButton?.innerHTML || '';
  const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const slugMatch = /^\/contact\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i.exec(window.location.pathname);
  const slug = slugMatch ? slugMatch[1].toLowerCase() : '';
  const byId = id => document.getElementById(id);
  const putText = (id, value) => { const element = byId(id); if (element) element.textContent = value || ''; };
  const ready = () => {
    document.body.removeAttribute('aria-busy');
    if (loader) { loader.classList.remove('is-visible'); loader.setAttribute('aria-hidden', 'true'); }
  };
  function showFallback(title, message) {
    if (form) form.hidden = true;
    if (summary) summary.hidden = true;
    if (fallback) fallback.hidden = false;
    putText('contact-fallback-title', title);
    putText('contact-fallback-message', message);
  }
  function showFeedback(message, type) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = 'form-feedback' + (type ? ' ' + type : '');
  }

  async function init() {
    try {
      if (!slug) {
        showFallback('We couldn’t find this puppy link.', 'Please return to the available puppies page and choose a listing to contact us about.');
        return;
      }
      const response = await fetch('/api/puppies?slug=' + encodeURIComponent(slug), { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.puppy || result.puppy.slug !== slug) {
        showFallback(response.status === 404 ? 'This puppy listing is no longer available.' : 'We couldn’t load this puppy right now.', response.status === 404 ? 'This listing may have been removed. Browse available puppies to see the current listings.' : 'Please try again in a moment, or return to the available puppies page.');
        return;
      }
      const puppy = result.puppy;
      document.title = 'Contact us about ' + puppy.name + ' | Papillon & Co.';
      putText('contact-puppy-name', puppy.name + '.');
      putText('contact-breadcrumb-name', 'Contact about ' + puppy.name);
      putText('contact-puppy-summary-name', puppy.name);
      putText('contact-puppy-summary-age', [puppy.age, puppy.gender].filter(Boolean).join(' · '));
      putText('contact-puppy-summary-price', 'C$' + new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(Number(puppy.price) || 0));
      const image = byId('contact-puppy-image');
      if (image) { image.src = puppy.image; image.alt = puppy.imageAlt || puppy.name; }
      const backLink = byId('back-to-puppy-link');
      if (backLink) backLink.href = '/' + encodeURIComponent(puppy.slug);
      putText('contact-puppy-hidden-name', puppy.name);
      const hiddenName = byId('contact-puppy-hidden-name'); if (hiddenName) hiddenName.value = puppy.name;
      const hiddenSlug = byId('contact-puppy-slug'); if (hiddenSlug) hiddenSlug.value = puppy.slug;
      if (summary) summary.hidden = false;
      if (form) form.hidden = false;
      if (image && image.decode) await Promise.race([image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 8000))]);
    } catch (error) {
      console.error('Could not prepare puppy contact page:', error);
      showFallback('We couldn’t load this puppy right now.', 'Please try again in a moment, or return to the available puppies page.');
    } finally {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      ready();
    }
  }

  if (form && submitButton) {
    const requiredFields = [
      { input: form.elements.name, label: 'your full name', valid: value => String(value || '').trim().length >= 2 },
      { input: form.elements.email, label: 'a valid email address', valid: value => EMAIL_RE.test(String(value || '').trim()) },
      { input: form.elements.shippingAddress, label: 'your street address', valid: value => String(value || '').trim().length >= 3 },
      { input: form.elements.city, label: 'your city', valid: value => String(value || '').trim().length >= 2 },
      { input: form.elements.country, label: 'your country', valid: value => String(value || '').trim().length >= 2 },
      { input: form.elements.preferredPaymentMethod, label: 'your preferred payment method', valid: value => String(value || '').trim().length >= 2 }
    ];
    requiredFields.forEach(({ input }) => input?.addEventListener('input', () => { input.classList.remove('invalid'); showFeedback('', ''); }));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitButton.disabled) return;
      showFeedback('', '');
      let firstInvalid = null;
      const invalid = [];
      requiredFields.forEach(field => {
        const valid = field.valid(field.input?.value);
        field.input?.classList.toggle('invalid', !valid);
        if (!valid) { invalid.push(field.label); if (!firstInvalid) firstInvalid = field.input; }
      });
      if (invalid.length) { showFeedback('Please provide ' + invalid.join(', ') + '.', 'error'); firstInvalid?.focus(); return; }
      if (form.elements.website.value.trim()) return;
      const payload = {
        enquiryType: 'puppy-contact',
        puppy: form.elements.puppy.value,
        puppySlug: form.elements.puppySlug.value,
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
        shippingAddress: form.elements.shippingAddress.value.trim(),
        shippingAddress2: form.elements.shippingAddress2.value.trim(),
        city: form.elements.city.value.trim(),
        region: form.elements.region.value.trim(),
        postalCode: form.elements.postalCode.value.trim(),
        country: form.elements.country.value.trim(),
        preferredPaymentMethod: form.elements.preferredPaymentMethod.value,
        message: form.elements.message.value.trim(),
        website: form.elements.website.value
      };
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'Sending…';
      try {
        const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'We could not send your enquiry right now. Please try again.');
        showFeedback('Your enquiry has been sent. We’ll contact you to confirm availability, shipping, and payment arrangements.', 'success');
        form.reset();
        const hiddenSlug = byId('contact-puppy-slug'); if (hiddenSlug) hiddenSlug.value = slug;
        const hiddenName = byId('contact-puppy-hidden-name'); if (hiddenName) hiddenName.value = byId('contact-puppy-summary-name')?.textContent || '';
      } catch (error) {
        showFeedback(error instanceof TypeError ? 'The contact service could not be reached. Please try again later.' : (error.message || 'We could not send your enquiry right now. Please try again.'), 'error');
      } finally {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.innerHTML = originalButton;
      }
    });
  }
  init();
})();
