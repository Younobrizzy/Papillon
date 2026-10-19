(function () {
  'use strict';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function addHoneypot(form) {
    if (form.elements.website) return form.elements.website;
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.style.cssText = 'position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important;';
    const label = document.createElement('label');
    label.htmlFor = 'contact-company-website-' + Math.random().toString(36).slice(2);
    label.textContent = 'Leave this field empty';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'website';
    input.id = label.htmlFor;
    input.tabIndex = -1;
    input.autocomplete = 'off';
    input.setAttribute('autocomplete', 'new-password');
    label.appendChild(input);
    wrapper.appendChild(label);
    form.prepend(wrapper);
    return input;
  }

  function initForm(form) {
    const feedback = form.querySelector('.form-feedback');
    const submitButton = form.querySelector('button[type="submit"]');
    if (!feedback || !submitButton) return;
    const honeypot = addHoneypot(form);
    const originalButtonHtml = submitButton.innerHTML;
    const subjectInput = form.elements.subject;
    const initialSubject = subjectInput ? subjectInput.value : '';

    const fields = [
      { input: form.elements.name, label: 'your name', validate: value => String(value || '').trim().length >= 2 && String(value || '').trim().length <= 100 },
      { input: form.elements.email, label: 'a valid email address', validate: value => EMAIL_RE.test(String(value || '').trim()) && String(value || '').trim().length <= 254 },
      { input: form.elements.subject, label: 'a subject', validate: value => String(value || '').trim().length >= 2 && String(value || '').trim().length <= 180 },
      { input: form.elements.message, label: 'a message', validate: value => String(value || '').trim().length >= 2 && String(value || '').trim().length <= 8000 }
    ].filter(field => field.input);

    fields.forEach(({ input }) => {
      input.addEventListener('input', () => {
        input.classList.remove('invalid');
        feedback.textContent = '';
        feedback.className = 'form-feedback';
      });
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitButton.disabled) return;
      feedback.textContent = '';
      feedback.className = 'form-feedback';

      let firstInvalid = null;
      const invalidLabels = [];
      fields.forEach(field => {
        const valid = field.validate(field.input.value);
        field.input.classList.toggle('invalid', !valid);
        if (!valid) {
          invalidLabels.push(field.label);
          if (!firstInvalid) firstInvalid = field.input;
        }
      });
      if (invalidLabels.length) {
        feedback.textContent = 'Please enter ' + invalidLabels.join(', ') + ' correctly.';
        feedback.classList.add('error');
        firstInvalid?.focus();
        return;
      }

      const puppyNameElement = document.getElementById('enquiry-puppy-name');
      const puppy = puppyNameElement ? puppyNameElement.textContent.trim() : '';
      const payload = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        subject: form.elements.subject.value.trim(),
        message: form.elements.message.value.trim(),
        puppy,
        website: honeypot.value
      };

      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'Sending…';
      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'We could not send your message. Please try again.');

        feedback.textContent = result.message || 'Your message has been sent successfully. Thank you for getting in touch.';
        feedback.classList.add('success');
        form.reset();
        if (puppy && subjectInput) subjectInput.value = initialSubject || ('Enquiry about ' + puppy);
      } catch (error) {
        feedback.textContent = error instanceof TypeError
          ? 'The contact service could not be reached. Please try again later.'
          : (error.message || 'We could not send your message right now. Please try again.');
        feedback.classList.add('error');
      } finally {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.innerHTML = originalButtonHtml;
      }
    });
  }

  document.querySelectorAll('#contact-form, #puppy-enquiry-form').forEach(initForm);
})();
