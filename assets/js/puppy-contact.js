(function () {
  'use strict';

  const content = document.getElementById('puppy-contact-content');
  const errorState = document.getElementById('puppy-contact-error');
  const errorTitle = document.getElementById('contact-error-title');
  const errorMessage = document.getElementById('contact-error-message');
  const image = document.getElementById('contact-puppy-image');
  const imagePlaceholder = document.getElementById('contact-puppy-image-placeholder');
  const form = document.getElementById('puppy-contact-form');
  const feedback = document.getElementById('puppy-contact-feedback');
  const submitButton = document.getElementById('puppy-contact-submit');
  const originalButtonText = submitButton ? submitButton.innerHTML : '';
  const pathMatch = window.location.pathname.match(/^\/contact\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
  const slug = pathMatch ? pathMatch[1].toLowerCase() : '';
  let puppy = null;
  let lastRequestAborted = false;

  function putText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || '');
  }

  function waitForPaint() {
    return new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  }

  function waitForImageReady(target, timeoutMs) {
    if (!target || target.hidden || !target.getAttribute('src')) return Promise.resolve(true);
    if (target.complete) return Promise.resolve(target.naturalWidth > 0);
    return new Promise(resolve => {
      let settled = false;
      const timer = window.setTimeout(() => finish(target.complete && target.naturalWidth > 0), timeoutMs || 8000);
      function finish(ok) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        target.removeEventListener('load', onLoad);
        target.removeEventListener('error', onError);
        resolve(Boolean(ok));
      }
      function onLoad() { finish(target.naturalWidth > 0); }
      function onError() { finish(false); }
      target.addEventListener('load', onLoad, { once: true });
      target.addEventListener('error', onError, { once: true });
      if (target.complete) finish(target.naturalWidth > 0);
    });
  }

  function showError(kind) {
    if (content) content.hidden = true;
    if (errorState) errorState.hidden = false;
    if (kind === 'not-found') {
      putText('contact-error-title', "We couldn't find that puppy.");
      putText('contact-error-message', 'This puppy listing may have moved or is no longer available. Browse the current listings to choose a puppy.');
      document.title = 'Puppy Not Found | Papillon & Co.';
    } else {
      putText('contact-error-title', "We couldn't load this puppy.");
      putText('contact-error-message', 'The puppy details are temporarily unavailable. Please try again in a moment or browse the current listings.');
      document.title = 'Puppy Enquiry Unavailable | Papillon & Co.';
    }
  }

  function setFeedback(message, type) {
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.className = 'form-feedback';
    if (type) feedback.classList.add(type);
  }

  function addHoneypot() {
    if (!form || form.elements.website) return;
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.style.cssText = 'position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important;';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'website';
    input.tabIndex = -1;
    input.autocomplete = 'off';
    input.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(input);
    form.prepend(wrapper);
  }

  function renderPuppy(record) {
    puppy = record;
    const name = String(record.name || 'Puppy').trim();
    putText('contact-breadcrumb-name', name);
    putText('contact-title-puppy', name + '.');
    putText('contact-puppy-name', name);
    const facts = [record.age, record.gender].map(value => String(value || '').trim()).filter(Boolean);
    putText('contact-puppy-facts', facts.join(' · '));
    const price = Number(record.price);
    putText('contact-puppy-price', Number.isFinite(price) && price > 0
      ? 'C$' + new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(price)
      : 'Price to be confirmed');
    putText('contact-puppy-status', record.status || 'Availability to be confirmed');
    if (image && record.image) {
      image.src = record.image;
      image.alt = String(record.imageAlt || (name + ' puppy'));
      image.hidden = false;
      if (imagePlaceholder) imagePlaceholder.hidden = true;
      image.addEventListener('error', function () {
        image.hidden = true;
        if (imagePlaceholder) imagePlaceholder.hidden = false;
      }, { once: true });
    }
    document.title = 'Enquiry about ' + name + ' | Papillon & Co.';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', 'Share your contact and delivery preferences about ' + name + '. Papillon & Co. will confirm availability and next steps with you.');
    if (content) content.hidden = false;
    if (errorState) errorState.hidden = true;
  }

  async function loadPuppy() {
    if (!slug) {
      showError('not-found');
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => { lastRequestAborted = true; controller.abort(); }, 15000);
    try {
      const response = await fetch('/api/puppies?slug=' + encodeURIComponent(slug) + '&summary=1', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 404) {
        showError('not-found');
        return;
      }
      if (!response.ok || !result.puppy || !result.puppy.name) {
        showError('unavailable');
        return;
      }
      renderPuppy(result.puppy);
      await waitForImageReady(image, 8000);
    } catch (error) {
      showError(lastRequestAborted || error?.name === 'AbortError' ? 'unavailable' : 'unavailable');
    } finally {
      window.clearTimeout(timeoutId);
      await waitForPaint();
      window.dispatchEvent(new Event('papillon:puppy-contact-ready'));
    }
  }

  if (form && submitButton) {
    addHoneypot();
    form.addEventListener('input', () => setFeedback('', ''));
    form.addEventListener('change', () => setFeedback('', ''));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitButton.disabled || !puppy) return;
      setFeedback('', '');
      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const addressLines = [
        String(data.get('addressLine1') || '').trim(),
        String(data.get('addressLine2') || '').trim()
      ].filter(Boolean);
      const additionalNotes = String(data.get('notes') || '').trim();
      const messageLines = [
        'Puppy: ' + puppy.name,
        'Puppy listing: /contact/' + slug,
        '',
        'Contact phone: ' + String(data.get('phone') || '').trim(),
        '',
        'Shipping address:',
        ...addressLines,
        [String(data.get('city') || '').trim(), String(data.get('region') || '').trim()].filter(Boolean).join(', '),
        [String(data.get('postalCode') || '').trim(), String(data.get('country') || '').trim()].filter(Boolean).join(', '),
        '',
        'Preferred delivery option: ' + String(data.get('deliveryMethod') || ''),
        'Preferred payment method: ' + String(data.get('paymentMethod') || ''),
        ...(additionalNotes ? ['', 'Additional questions or notes:', additionalNotes] : []),
        '',
        'The visitor acknowledged that this is an enquiry only and no payment or booking is made by this form.'
      ];
      const payload = {
        name: String(data.get('name') || '').trim(),
        email: String(data.get('email') || '').trim(),
        subject: 'Enquiry about ' + puppy.name + ': delivery and payment preferences',
        message: messageLines.join('\n').slice(0, 7800),
        puppy: puppy.name,
        website: String(data.get('website') || '')
      };

      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'Sending enquiry…';
      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'We could not send your enquiry right now. Please try again in a moment.');
        form.reset();
        setFeedback('Thank you. Your enquiry about ' + puppy.name + ' has been sent. We will contact you to confirm availability, total costs, delivery arrangements, and payment options. No payment has been taken.', 'success');
      } catch (error) {
        setFeedback(error instanceof TypeError
          ? 'The enquiry service could not be reached. Please try again later.'
          : (error.message || 'We could not send your enquiry right now. Please try again in a moment.'), 'error');
      } finally {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.innerHTML = originalButtonText;
      }
    });
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
  loadPuppy();
})();
