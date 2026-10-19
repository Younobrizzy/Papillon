(function () {
  'use strict';

  var PENDING_KEY = 'papillon.navigation.pendingAt';
  var PENDING_TTL = 12000;
  var MIN_VISIBLE_MS = 420;
  var SAME_PAGE_VISIBLE_MS = 520;
  var NAVIGATION_DELAY_MS = 140;
  var MAX_DESTINATION_VISIBLE_MS = 1500;
  var loader = null;
  var shownAt = 0;
  var hideTimer = null;
  var maxTimer = null;

  function safeStorageGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (error) { return null; }
  }

  function safeStorageSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (error) { /* Storage may be blocked. */ }
  }

  function safeStorageRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (error) { /* Storage may be blocked. */ }
  }

  function ensureLoader() {
    if (loader) return loader;

    // Puppy pages ship the loader in HTML so it is visible before any script runs.
    loader = document.querySelector('.site-navigation-loader');
    if (loader) return loader;

    loader = document.createElement('div');
    loader.className = 'site-navigation-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.setAttribute('aria-hidden', 'true');
    loader.innerHTML = [
      '<div class="navigation-loader-content">',
      '  <span class="navigation-loader-spinner" aria-hidden="true"><span class="navigation-loader-mark"><img src="/assets/images/brand/papillon-mark.svg?v=20261017b" alt="" width="32" height="32" decoding="async" /></span></span>',
      '  <p class="navigation-loader-brand">Papillon <i>&amp;</i> Co.</p>',
      '  <p class="navigation-loader-message">One little moment…</p>',
      '</div>'
    ].join('');
    document.body.appendChild(loader);
    return loader;
  }

  function showLoader() {
    var element = ensureLoader();
    window.clearTimeout(hideTimer);
    element.classList.add('is-visible');
    element.setAttribute('aria-hidden', 'false');
    document.body.setAttribute('aria-busy', 'true');
    shownAt = Date.now();
  }

  function hideLoader() {
    if (!loader) return;
    window.clearTimeout(hideTimer);
    window.clearTimeout(maxTimer);
    loader.classList.remove('is-visible');
    loader.setAttribute('aria-hidden', 'true');
    document.body.removeAttribute('aria-busy');
  }

  function hideAfterMinimumTime() {
    var remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt));
    hideTimer = window.setTimeout(hideLoader, remaining);
  }

  function isSameDocument(url) {
    return url.origin === window.location.origin &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search;
  }

  // Puppy detail pages must stay covered until the listing content and primary image resolve.
  // Other pages keep the ordinary navigation transition with its short maximum duration.
  var isPuppyDetailPage = Boolean(document.body && document.body.classList.contains('puppy-detail-page'));
  var isPuppyContactPage = Boolean(document.body && document.body.classList.contains('puppy-contact-page'));
  var pendingAt = Number(safeStorageGet(PENDING_KEY));
  safeStorageRemove(PENDING_KEY);
  if (isPuppyDetailPage) {
    showLoader();
    window.addEventListener('papillon:puppy-detail-ready', hideAfterMinimumTime, { once: true });
  } else if (isPuppyContactPage) {
    showLoader();
    window.addEventListener('papillon:puppy-contact-ready', hideAfterMinimumTime, { once: true });
  } else if (pendingAt && Date.now() - pendingAt < PENDING_TTL) {
    showLoader();
    maxTimer = window.setTimeout(hideLoader, MAX_DESTINATION_VISIBLE_MS);
    if (document.readyState === 'complete') {
      hideAfterMinimumTime();
    } else {
      window.addEventListener('load', hideAfterMinimumTime, { once: true });
    }
  }

  // Restore the page cleanly when returning from the browser's back-forward cache.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      safeStorageRemove(PENDING_KEY);
      hideLoader();
    }
  });

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;

    var anchor = event.target.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-no-nav-loading')) return;
    if (anchor.closest('[data-no-nav-loading]')) return;

    var target = (anchor.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return;

    var destination;
    try { destination = new URL(anchor.href, window.location.href); } catch (error) { return; }
    if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return;
    if (anchor.getAttribute('href').trim() === '' || anchor.getAttribute('href').trim() === '#') return;

    // In-page section links still work natively; the loader briefly acknowledges the tap.
    if (isSameDocument(destination) && destination.hash) {
      showLoader();
      hideTimer = window.setTimeout(hideLoader, SAME_PAGE_VISIBLE_MS);
      return;
    }

    showLoader();
    if (destination.origin === window.location.origin) {
      safeStorageSet(PENDING_KEY, String(Date.now()));
    }

    // A short delay gives the loader a chance to paint before the browser changes documents.
    event.preventDefault();
    window.setTimeout(function () {
      window.location.assign(destination.href);
    }, NAVIGATION_DELAY_MS);
  });
})();
