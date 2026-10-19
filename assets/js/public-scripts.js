/* Loads the administrator-managed public site snippet through
   /api/public-scripts and executes valid script tags from the saved snippet. */
(() => {
  if (window.__papillonPublicScriptsStarted) return;
  window.__papillonPublicScriptsStarted = true;

  function activateSnippet(snippet) {
    const source = String(snippet || '').trim();
    if (!source) return;

    // Support pasting a raw JavaScript body as well as a full HTML/script snippet.
    if (!/<\/?[a-z][\s\S]*>/i.test(source)) {
      const rawScript = document.createElement('script');
      rawScript.textContent = source;
      document.body.appendChild(rawScript);
      return;
    }

    const template = document.createElement('template');
    template.innerHTML = source;
    const scripts = Array.from(template.content.querySelectorAll('script'));
    const scriptQueue = [];

    scripts.forEach((original) => {
      const marker = document.createComment('papillon-public-script');
      original.replaceWith(marker);
      scriptQueue.push({ original, marker });
    });

    // Add widget containers and other markup first so scripts can find their mounts.
    document.body.appendChild(template.content);

    // Recreate script elements: script nodes parsed using innerHTML are inert.
    // Preserve attributes (src, type, integrity, crossorigin, nonce, etc.) from the saved snippet.
    scriptQueue.forEach(({ original, marker }) => {
      if (!marker.isConnected) return;
      const active = document.createElement('script');
      Array.from(original.attributes).forEach(({ name, value }) => active.setAttribute(name, value));
      if (original.src && !original.hasAttribute('async')) active.async = false;
      active.textContent = original.textContent || '';
      marker.replaceWith(active);
    });
  }

  function showContactPhone(value) {
    const phone = String(value || '').trim();
    document.querySelectorAll('[data-contact-phone]').forEach(container => {
      const link = container.querySelector('[data-contact-phone-link]');
      if (!link || !phone) {
        container.hidden = true;
        return;
      }
      // The API validates this field, but restrict the dial target defensively too.
      const dialTarget = phone.replace(/[^0-9+]/g, '');
      if (!dialTarget || !/^\+?\d+$/.test(dialTarget)) {
        container.hidden = true;
        return;
      }
      link.textContent = phone;
      link.href = 'tel:' + dialTarget;
      container.hidden = false;
    });
  }

  async function loadPublicScripts() {
    try {
      const response = await fetch('/api/public-scripts', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit'
      });
      if (!response.ok) return;
      const result = await response.json();
      if (result && typeof result.phoneNumber === 'string') showContactPhone(result.phoneNumber);
      else showContactPhone('');
      if (result && typeof result.script === 'string') activateSnippet(result.script);
    } catch (error) {
      // A live-chat provider must not interfere with the core website if unavailable.
      // Keep any contact phone already rendered at the edge in the initial HTML.
      // A transient optional-config failure should not hide server-rendered content.
      console.warn('Optional public site configuration could not be loaded.', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPublicScripts, { once: true });
  } else {
    loadPublicScripts();
  }
})();
